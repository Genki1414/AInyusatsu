// 発注機関ごとの「取れているか」を確かめる（実装仕様書_v1.md §5 coverage_check）。
//
// 【これまで何が抜けていたか】
// agencies.expected_freq（daily / weekly / monthly）と last_success_at で欠測を検知する
// 設計だったが、last_success_at を書き込む処理がどこにも無かった。そのため
// agency_leaf_coverage ビューは常にカバレッジ0を返していた。
// ここで「取れたら記録する」側と「古すぎないか確かめる」側の両方を用意する。
//
// 判定そのものは packages/domain/src/coverage.ts の純ロジック。

import { createServiceClient } from "@ai-nyusatsu-bu/db";
import { evaluateCoverage, type CoverageAgency, type CoverageSummary } from "@ai-nyusatsu-bu/domain";

type Supabase = ReturnType<typeof createServiceClient>;

type AgencyRow = {
  id: string;
  name: string;
  expected_freq: string | null;
  last_success_at: string | null;
  /** [{connector, url, kind}] を想定（実装仕様書_v1.md §2） */
  sources: { connector?: string }[] | null;
};

export type CoverageCheckResult = {
  /** 判定対象（expected_freq がある機関）の数 */
  checked: number;
  /** そのうち想定どおり取れている数 */
  healthy: number;
  /** 対応が要る機関（欠測・未取得） */
  missing: number;
  /** 様子見の機関（遅延） */
  delayed: number;
  /** 巡回をまだ実装していない機関 */
  notImplemented: number;
};

/**
 * 案件を取得できた機関の last_success_at を更新する。
 * 巡回・同期のジョブから、取得できた機関のIDを渡して呼ぶ。
 *
 * ここが動かないと欠測検知が成立しないが、収集そのものは成功しているので、
 * 記録に失敗しても収集ジョブは止めない（ログには必ず残す）。
 */
export async function recordAgencySuccess(
  client: Supabase,
  agencyIds: Iterable<string>,
  at: Date = new Date(),
): Promise<number> {
  const ids = [...new Set(agencyIds)];
  if (ids.length === 0) return 0;

  const { error } = await client
    .from("agencies")
    .update({ last_success_at: at.toISOString() })
    .in("id", ids);
  if (error) {
    console.error(`[coverage] last_success_at の更新に失敗しました（${ids.length}機関）: ${error.message}`);
    return 0;
  }
  return ids.length;
}

/**
 * 機関ごとの状態を判定して返す。画面（今日やること）もこの関数の判定を使う。
 * 子を持つ機関（府省など）は公告を出す単位ではないため対象にしない
 * （機関マスタ_v2.md §4「葉ノード基準」）。
 */
export async function loadCoverage(client: Supabase, now: Date = new Date()): Promise<CoverageSummary> {
  const { data, error } = await client
    .from("agencies")
    .select("id, name, expected_freq, last_success_at, sources, parent_id")
    .eq("active", true)
    .returns<(AgencyRow & { parent_id: string | null })[]>();
  if (error) throw new Error(`機関の取得に失敗しました: ${error.message}`);

  const rows = data ?? [];
  const hasChild = new Set(rows.map((r) => r.parent_id).filter((id): id is string => id !== null));
  const leaves: CoverageAgency[] = rows
    .filter((r) => !hasChild.has(r.id))
    .map((r) => ({
      id: r.id,
      name: r.name,
      expectedFreq: r.expected_freq,
      lastSuccessAt: r.last_success_at,
      connectors: (r.sources ?? []).map((src) => src.connector).filter((c): c is string => typeof c === "string"),
    }));

  return evaluateCoverage(leaves, now);
}

/**
 * 欠測を確かめてログに出す。
 * 取れていないことを黙って隠さない（CLAUDE.md 最重要の前提7）。
 */
export async function runCoverageCheck(now: Date = new Date()): Promise<CoverageCheckResult> {
  const client = createServiceClient();
  const summary = await loadCoverage(client, now);

  console.log(
    `[coverage_check] 判定対象${summary.checked}機関：正常${summary.healthy} / 遅延${summary.delayed.length}` +
      ` / 要対応${summary.missing.length} / 巡回未実装${summary.notImplemented.length}`,
  );
  for (const agency of summary.notImplemented) {
    // 障害ではなく未着手の作業。区別が付くように別の文言で出す
    console.log(`[coverage_check] 巡回未実装：${agency.name}（${agency.id}／想定${agency.expectedFreq}）`);
  }
  for (const agency of summary.missing) {
    const since = agency.daysSince === null ? "一度も取得できていません" : `最終取得から${Math.floor(agency.daysSince)}日`;
    console.warn(`[coverage_check] ${agency.status}：${agency.name}（${agency.id}／想定${agency.expectedFreq}／${since}）`);
  }
  for (const agency of summary.delayed) {
    console.warn(
      `[coverage_check] 遅延：${agency.name}（${agency.id}／想定${agency.expectedFreq}／最終取得から${Math.floor(agency.daysSince ?? 0)}日）`,
    );
  }

  return {
    checked: summary.checked,
    healthy: summary.healthy,
    missing: summary.missing.length,
    delayed: summary.delayed.length,
    notImplemented: summary.notImplemented.length,
  };
}
