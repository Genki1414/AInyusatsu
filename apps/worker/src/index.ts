// 常駐ワーカーの起動エントリポイント（Railway で動かす）。
// docs/本番環境_推奨構成.md：「収集ワーカーは Railway に Node + Playwright を常駐」。
//
// pg-boss がジョブキューとスケジューラを兼ねる。スケジュールは Supabase の Postgres に
// 保存されるので、ワーカーが再起動しても消えない。
//
// 【これまでとの違い】
// これまでは巡回も解析も提案も催促も、すべて手でコマンドを叩く必要があった。
// このプロセスが常駐していれば、決まった時刻に自動で走る。
// 各ジョブの中身は apps/worker/jobs/ の関数そのままで、ここは呼び出すだけ。
//
// 【必要な環境変数】
//   DATABASE_URL              pg-boss が使う Postgres の接続文字列
//                             （Supabase の Session pooler。Transaction pooler は不可）
//   NEXT_PUBLIC_SUPABASE_URL  / SUPABASE_SERVICE_ROLE_KEY
//   ANTHROPIC_API_KEY         AI解析
//   RESEND_API_KEY / RESEND_FROM_ADDRESS  催促メール
//   APP_URL                   協力会社の回答ページのURL（旧 NEXT_PUBLIC_APP_URL も可）
//   GEPS_CONTACT_*            調達ポータルの資料取得
//   ANALYZE_DAILY_LIMIT       1回の解析で処理する件数の上限（既定50）
//   ADMIN_EMAILS              本部への異常通知の宛先（カンマ区切り。Webの運営画面と同じ値）
//   DISABLED_JOBS             止めたいジョブ名をカンマ区切りで（例: analyze-pending）

import { PgBoss } from "pg-boss";
import { runKkjSync } from "../jobs/kkj_sync";
import { runDailyGepsCrawl } from "../jobs/crawl_geps";
import { runExtractPendingDocuments } from "../jobs/extract_document_text";
import { runAnalyzePending } from "../jobs/analyze_pending";
import { runTenderLifecycle } from "../jobs/tender_lifecycle";
import { runMatchTenders } from "../jobs/match_tenders";
import { runNotifyDigest } from "../jobs/notify_digest";
import { runNotifyInstant } from "../jobs/notify_instant";
import { runCoverageCheck } from "../jobs/coverage_check";
import { runNotifyOps } from "../jobs/notify_ops";
import { runQuoteReminders } from "../jobs/remind_quotes";
import { runDiffImport } from "../jobs/import_awards";
import { refreshMarketRates } from "../jobs/refresh_market_rates";
import { activeSchedule, parseDisabledJobs, TIMEZONE, type JobName } from "./schedule";

/** 今日の日付（Asia/Tokyo）を YYYY-MM-DD で返す。巡回・同期の対象日に使う。 */
function todayJst(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: TIMEZONE });
}

/** 前日（Asia/Tokyo）。落札実績の差分取り込みに使う。 */
function yesterday(): Date {
  return new Date(Date.now() - 24 * 60 * 60 * 1000);
}

/** ジョブ名 → 実際の処理。戻り値はログに出すだけなので型は緩くてよい。 */
const HANDLERS: Record<JobName, () => Promise<unknown>> = {
  "kkj-sync": () => runKkjSync(todayJst()),
  "crawl-geps": () => runDailyGepsCrawl(todayJst()),
  "extract-text": () => runExtractPendingDocuments(),
  "analyze-pending": () => runAnalyzePending(),
  "tender-lifecycle": () => runTenderLifecycle(),
  "match-tenders": () => runMatchTenders(),
  "notify-digest": () => runNotifyDigest(),
  "notify-instant": () => runNotifyInstant(),
  "coverage-check": () => runCoverageCheck(),
  "notify-ops": () => runNotifyOps(),
  "remind-quotes": () => runQuoteReminders(),
  // 落札実績は前日ぶんの差分を取り込む（当日ぶんはまだ公開されていない）
  "import-awards": () => runDiffImport(yesterday()),
  "refresh-market-rates": () => refreshMarketRates(),
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} が設定されていません。ワーカーを起動できません`);
  return value;
}

async function main(): Promise<void> {
  const boss = new PgBoss(requireEnv("DATABASE_URL"));

  // pg-boss 自体のエラーで落とさない。落とすとRailwayが再起動を繰り返すだけで、
  // 原因が流れて分からなくなる。
  boss.on("error", (err) => console.error("[worker] pg-boss のエラー", err));

  await boss.start();
  console.log("[worker] pg-boss を起動しました");

  const disabled = parseDisabledJobs(process.env.DISABLED_JOBS);
  const jobs = activeSchedule(disabled);
  if (disabled.size > 0) {
    console.warn(`[worker] 停止中のジョブ: ${[...disabled].join(", ")}`);
  }

  for (const job of jobs) {
    await boss.createQueue(job.name);

    // 1件ずつ順に処理する。巡回もAI解析も重く、並列にすると相手先にも負荷がかかる。
    await boss.work(job.name, { batchSize: 1 }, async () => {
      const startedAt = Date.now();
      console.log(`[worker] ${job.name} を開始します（${job.description}）`);
      try {
        const result = await HANDLERS[job.name]();
        const seconds = Math.round((Date.now() - startedAt) / 1000);
        console.log(`[worker] ${job.name} が完了しました（${seconds}秒）: ${JSON.stringify(result)}`);
      } catch (err) {
        // 失敗はログに残して、そのジョブだけ失敗させる（他のジョブは動き続ける）。
        console.error(`[worker] ${job.name} が失敗しました`, err);
        throw err;
      }
    });

    // 同じ名前で登録し直すと上書きされるので、起動のたびに呼んで構わない。
    await boss.schedule(job.name, job.cron, null, { tz: TIMEZONE });
    console.log(`[worker] 登録: ${job.name}  ${job.cron}（${TIMEZONE}）  ${job.description}`);
  }

  // 止めたジョブのスケジュールが残っていると、DISABLED_JOBS を設定しても走り続ける。
  for (const name of disabled) {
    await boss.unschedule(name);
    console.log(`[worker] スケジュールを解除しました: ${name}`);
  }

  const shutdown = async (signal: string) => {
    console.log(`[worker] ${signal} を受け取りました。実行中のジョブを待って停止します`);
    await boss.stop({ graceful: true });
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  console.log(`[worker] ${jobs.length}件のジョブを登録しました。待機します`);
}

main().catch((err) => {
  console.error("[worker] 起動に失敗しました", err);
  process.exitCode = 1;
});
