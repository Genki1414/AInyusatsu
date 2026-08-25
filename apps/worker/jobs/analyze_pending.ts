// 解析待ちの案件をまとめて解析する（常駐ワーカー用）。
//
// 手で1件ずつ叩いていた analyzeTender を、自動実行のために束ねたもの。
// 対象は「資料が取得済みで、テキスト抽出も済んでいる案件」（collect_status = 取得済）。
// analyzeTender が成功すると 解析完了 に進むので、次回は拾われない。
//
// 【日次の上限について】
// 実測で1案件あたり約69円（プロンプトキャッシュ実装後・平均サイズ）。自動で回すと
// 請求が見えにくくなるため、1回の実行で処理する件数に上限を設ける。
// 上限に達した分は次回に回すだけで、失われはしない。
// 全件を解析したい場合は ANALYZE_DAILY_LIMIT を引き上げる（0 にすると解析を止められる）。
//
// 【公告日が古い案件を解析しない（任意）】
// 提出期限はコネクタからは取れず、AI解析で初めて埋まる。つまり解析前の案件はすべて
// submit_deadline が null で、期限切れとして終了に落とせない。解析を後回しにするほど
// 解析待ちは積み上がり、いざ流すときに、とっくに締め切られた案件にも費用がかかる。
// ANALYZE_MAX_NOTICE_AGE_DAYS を指定すると、公告日がそれより古い案件を解析しない。
// 公告日は提出期限そのものではないため、既定では絞らない（推測で対象を減らさない）。
//
// 【全省庁統一資格の範囲だけを解析する】
// KKJは国の機関も自治体も、物品も工事も区別せずに返す。実測（2026-08-21の公告日ぶん）
// では1日543件のうち25%が建設工事だった。自治体・建設工事は「やらないこと」（CLAUDE.md）
// なので、対象外と決めてある案件に費用を払わないよう、解析の前に落とす。
// 判定の元になる agencies.gov_scope は `agencies:classify` が埋める。
// 分類していない機関（gov_scope が null）は解析しない。推測で費用を払わない。
//
// 【提出期限を過ぎた案件を解析しない】
// 対象は提出期限の近い順に並べるので、期限切れの案件を落としておかないと、死んだ案件が
// 真っ先に解析されて費用だけがかかる。tender_lifecycle が毎日落としているが、ここでも
// 念のため除外する（解析は費用がかかるので、二重に守る）。

import { createServiceClient } from "@ai-nyusatsu-bu/db";
import { estimateCostYen, summarizeUsage, type UsageSummary } from "@ai-nyusatsu-bu/ai";
import { judgeQualificationScope, noticeDateCutoff, parseMaxNoticeAgeDays, shouldAnalyze, toDateIso } from "@ai-nyusatsu-bu/domain";
import { analyzeTender } from "./analyze_tender";
import { runTenderLifecycle } from "./tender_lifecycle";

/** 1回の実行で解析する件数の既定値。実測 約69円/件 なので、50件で約3,500円。 */
export const DEFAULT_ANALYZE_LIMIT = 50;

export type AnalyzePendingSummary = {
  /** 解析できた件数 */
  analyzed: number;
  /** 解析に失敗した件数（理由は案件側に記録済み） */
  failed: number;
  /** 上限に達して次回に回した件数 */
  deferred: number;
  /** 今回の推定費用（円） */
  estimatedYen: number;
  /** 公告日で絞った場合の下限（絞っていなければ null） */
  noticeDateFrom: string | null;
  /** 統一資格の範囲外として解析しなかった件数 */
  outOfScope: number;
};

type PendingRow = { id: string; name: string; procurement: string; agencies: { gov_scope: string | null } | { gov_scope: string | null }[] | null };

function one<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

/** 環境変数から1回あたりの上限を読む。数値でなければ既定値に落とす。 */
/** 環境変数から「公告日が何日前まで」を読む。未設定なら絞らない。 */
export function maxNoticeAgeFromEnv(
  raw: string | undefined = process.env.ANALYZE_MAX_NOTICE_AGE_DAYS,
): number | null {
  return parseMaxNoticeAgeDays(raw);
}

export function analyzeLimitFromEnv(raw: string | undefined = process.env.ANALYZE_DAILY_LIMIT): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_ANALYZE_LIMIT;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    console.warn(`[analyze_pending] ANALYZE_DAILY_LIMIT が不正です（${raw}）。既定の${DEFAULT_ANALYZE_LIMIT}件を使います`);
    return DEFAULT_ANALYZE_LIMIT;
  }
  return parsed;
}

/**
 * 解析待ちの案件を、提出期限が近い順に解析する。
 * 1件の失敗で全体を止めない（理由は analyzeTender 側で案件に記録される）。
 */
export async function runAnalyzePending(
  limit: number = analyzeLimitFromEnv(),
  now: Date = new Date(),
  maxNoticeAgeDays: number | null = maxNoticeAgeFromEnv(),
): Promise<AnalyzePendingSummary> {
  const client = createServiceClient();
  const noticeDateFrom = maxNoticeAgeDays === null ? null : toDateIso(noticeDateCutoff(maxNoticeAgeDays, now));

  if (limit === 0) {
    console.warn("[analyze_pending] ANALYZE_DAILY_LIMIT=0 のため解析を行いません");
    return { analyzed: 0, failed: 0, deferred: 0, estimatedYen: 0, noticeDateFrom, outOfScope: 0 };
  }

  // 分類がまだなら、解析対象は0件になる。黙って0件で終わらせない
  const { count: classified } = await client
    .from("agencies")
    .select("id", { count: "exact", head: true })
    .not("gov_scope", "is", null);
  if (!classified) {
    console.warn(
      "[analyze_pending] 発注機関がまだ分類されていません（agencies.gov_scope が空）。" +
        "統一資格の範囲を判定できないため解析しません。先に `pnpm --filter worker agencies:classify apply` を実行してください",
    );
    return { analyzed: 0, failed: 0, deferred: 0, estimatedYen: 0, noticeDateFrom, outOfScope: 0 };
  }

  // 上限より1件多く引いて、次回に回した分があるかを知る。
  //
  // 統一資格の範囲（国の機関・工事以外）だけをDB側で絞る。ここで絞らずに後から落とすと、
  // 上限ぶん引いた中身が対象外ばかりで、解析が進まなくなる。
  // 絞り込みの条件は judgeQualificationScope と同じ意味になるようにし、取り出したあとに
  // もう一度ドメイン側で確かめる（食い違えばログに出る）。
  let query = client
    .from("tenders")
    .select("id, name, procurement, agencies!inner(gov_scope), tender_documents!inner(id)")
    .eq("collect_status", "取得済")
    .eq("agencies.gov_scope", "国")
    .neq("procurement", "工事")
    .not("tender_documents.extracted_text", "is", null)
    // 提出期限を過ぎた案件に費用をかけない。期限が取れていない案件は残す（推測しない）
    .or(`submit_deadline.is.null,submit_deadline.gte.${now.toISOString()}`)
    // 提出期限が近いものから。期限の無い案件は後回しにする
    .order("submit_deadline", { ascending: true, nullsFirst: false })
    .limit(limit + 1);
  if (noticeDateFrom !== null) {
    // 公告日が古い案件は、すでに締め切られている見込みが高い
    query = query.gte("notice_date", noticeDateFrom);
  }

  const { data: pending, error } = await query.returns<PendingRow[]>();
  if (error) throw new Error(`解析待ちの案件の取得に失敗しました: ${error.message}`);

  // inner join のぶん同じ案件が重複しうるので、ここで一意にする。
  const deduped = [...new Map((pending ?? []).map((t) => [t.id, t])).values()];

  // 判定の正はドメイン側に置く。DBの絞り込みと食い違ったら黙って解析しない
  let outOfScope = 0;
  const unique = deduped.filter((tender) => {
    const decision = judgeQualificationScope({
      govScope: (one(tender.agencies)?.gov_scope ?? "不明") as never,
      procurement: tender.procurement,
    });
    if (shouldAnalyze(decision)) return true;
    outOfScope++;
    console.warn(`[analyze_pending] 統一資格の範囲外のため解析しません（${tender.name}）：${decision.reason}`);
    return false;
  });

  const targets = unique.slice(0, limit);
  const deferred = Math.max(0, unique.length - targets.length);

  const scope = noticeDateFrom === null ? "" : `／公告日 ${noticeDateFrom} 以降に限定`;
  console.log(`[analyze_pending] 解析待ち ${unique.length}件のうち ${targets.length}件を処理します（上限${limit}件${scope}）`);

  const usages: UsageSummary[] = [];
  let analyzed = 0;
  let failed = 0;

  for (const tender of targets) {
    try {
      const result = await analyzeTender(tender.id);
      usages.push(result.usage);
      analyzed++;
    } catch (err) {
      // 1件の失敗で残りを止めない。理由は analyzeTender が案件へ記録済み。
      failed++;
      console.error(
        `[analyze_pending] 解析に失敗しました（tender=${tender.id} ${tender.name}）: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  const estimatedYen = usages.reduce((total, usage) => total + estimateCostYen(usage), 0);
  console.log(
    `[analyze_pending] 完了：解析${analyzed}件 / 失敗${failed}件 / 次回へ${deferred}件 / 推定費用 ${estimatedYen.toLocaleString("ja-JP")}円`,
  );
  if (deferred > 0) {
    // 黙って積み残さない。上限が実態に合っていないなら気づけるようにする。
    console.warn(
      `[analyze_pending] 上限に達したため${deferred}件を次回に回しました。全件を処理するには ANALYZE_DAILY_LIMIT を引き上げてください`,
    );
  }

  // 解析が終わった案件をその場で公開する。定時の tender_lifecycle を待つと、
  // 解析が長引いた日は提案が翌日に持ち越しになる。
  if (analyzed > 0) {
    try {
      const lifecycle = await runTenderLifecycle(now);
      console.log(`[analyze_pending] 解析後の公開：${lifecycle.published}件`);
    } catch (err) {
      // 公開に失敗しても解析結果は残っている。定時の tender_lifecycle が拾い直す。
      console.error(
        `[analyze_pending] 解析後の公開に失敗しました: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return { analyzed, failed, deferred, estimatedYen, noticeDateFrom, outOfScope };
}

/** 複数案件ぶんのトークン消費をまとめた集計（ログ用）。 */
export function totalUsage(usages: UsageSummary[]): UsageSummary {
  return summarizeUsage(
    usages.map((u) => ({
      inputTokens: u.inputTokens,
      cacheCreationTokens: u.cacheCreationTokens,
      cacheReadTokens: u.cacheReadTokens,
      outputTokens: u.outputTokens,
    })),
  );
}
