// 調達ポータル（GEPS）の巡回ジョブをローカルから実行するCLI。
// 使い方: pnpm --filter worker geps:crawl                          # 前日（JST）
//         pnpm --filter worker geps:crawl -- 2026-07-31             # 1日を指定
//         pnpm --filter worker geps:crawl -- 2026-07-01 2026-07-31  # 範囲を指定（最大31日）
// 事前にブラウザが必要: pnpm --filter worker exec playwright install chromium
// 参照：docs/reference/ローカル実行手順.md
//
// 【範囲指定について】
// 巡回は「公開開始日1日ぶん」が対象なので、過去の取りこぼしを埋めるには日付を
// 1日ずつ渡す必要がある。1日ぶんで数十分かかるため、範囲は最大31日まで。
// 1日が失敗しても残りは続ける（相手先の一時的な不調で全体を止めない）。

import { expandDateRange } from "@ai-nyusatsu-bu/domain";
import { runDailyGepsCrawl, type CrawlDateSummary } from "../jobs/crawl_geps";
import { cliArgs, rejectExtraArgs, requireDateIso, runCli } from "./_args";
import { yesterdayJst } from "./_date";

const USAGE = "pnpm --filter worker geps:crawl [-- YYYY-MM-DD [YYYY-MM-DD]]";

async function main() {
  const args = cliArgs();
  rejectExtraArgs(args, 2, USAGE);
  const [fromArg, toArg] = args;
  const dates = toArg
    ? expandDateRange(requireDateIso(fromArg, "開始日"), requireDateIso(toArg, "終了日"))
    : [fromArg ? requireDateIso(fromArg, "公開開始日") : yesterdayJst()];

  console.log(`調達ポータルの巡回を実行します（公開開始日=${dates[0]}${dates.length > 1 ? ` 〜 ${dates[dates.length - 1]}（${dates.length}日）` : ""}）`);

  const summaries: CrawlDateSummary[] = [];
  const failedDates: string[] = [];

  for (const [index, dateIso] of dates.entries()) {
    console.log(`[${index + 1}/${dates.length}] ${dateIso}`);
    try {
      const summary = await runDailyGepsCrawl(dateIso);
      summaries.push(summary);
      console.log(JSON.stringify(summary, null, 2));
      if (summary.status === "failed") failedDates.push(dateIso);
    } catch (err) {
      // 1日の失敗で残りを止めない。どの日が失敗したかは最後にまとめて出す。
      failedDates.push(dateIso);
      console.error(`${dateIso} の巡回に失敗しました: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (dates.length > 1) {
    const total = summaries.reduce(
      (acc, s) => ({
        found: acc.found + s.found,
        merged: acc.merged + s.merged,
        documents: acc.documents + s.documents,
        failed: acc.failed + s.failed,
        skipped: acc.skipped + s.skipped,
      }),
      { found: 0, merged: 0, documents: 0, failed: 0, skipped: 0 },
    );
    console.log(`合計（${dates.length}日）: ${JSON.stringify(total)}`);
  }

  if (failedDates.length > 0) {
    // 失敗を握りつぶさない。どの日をやり直せばよいか分かるようにする。
    console.error(`巡回に失敗した日: ${failedDates.join(", ")}`);
    process.exitCode = 1;
  }
}

runCli(main);
