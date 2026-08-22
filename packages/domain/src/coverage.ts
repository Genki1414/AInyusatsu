// 発注機関ごとの「取れているか」の判定（実装仕様書_v1.md §5 coverage_check）。
//
// 【なぜ必要か】
// 機関マスタには expected_freq（daily / weekly / monthly）を持たせている。
// これに対して最後に取得できた日時（last_success_at）が古すぎるなら、
// その機関の公告を取りこぼしている。
//
// 取りこぼしを黙って放置すると、ユーザーには「その機関は案件を出していない」ように
// 見えてしまう。CLAUDE.md 最重要の前提7 のとおり、「機関が出していない（正常）」と
// 「取得できていない（要対応）」は必ず分けて記録し、画面にも出す。
//
// 【二段階にする理由】
// 1回巡回に失敗しただけで「欠測」と言うと、相手先の一時的な不調でも警報が鳴り続け、
// そのうち誰も見なくなる。想定間隔を超えた時点で「遅延」、倍を超えたら「欠測」とする。

/** expected_freq の値と、取得の想定間隔（日）。 */
export const EXPECTED_FREQ_DAYS: Record<string, number> = {
  daily: 1,
  weekly: 7,
  monthly: 31,
};

export type CoverageAgency = {
  id: string;
  name: string;
  /** 取得の想定頻度。null なら欠測判定の基準が無い */
  expectedFreq: string | null;
  /** 最後に取得できた日時（ISO 8601）。一度も取れていなければ null */
  lastSuccessAt: string | null;
};

export type CoverageStatus =
  /** 想定間隔の内に取れている */
  | "正常"
  /** 想定間隔を過ぎた */
  | "遅延"
  /** 想定間隔の倍を過ぎた。取りこぼしている */
  | "欠測"
  /** 一度も取れていない */
  | "未取得"
  /** expected_freq が無く、判定できない */
  | "基準なし";

export type CoverageResult = CoverageAgency & {
  status: CoverageStatus;
  /** 最後の取得からの経過日数。一度も取れていなければ null */
  daysSince: number | null;
  /** 許容される間隔（日）。基準が無ければ null */
  allowedDays: number | null;
};

export type CoverageSummary = {
  results: CoverageResult[];
  /** 判定対象（基準がある機関）の数 */
  checked: number;
  /** そのうち正常な数 */
  healthy: number;
  /** 対応が要る機関（欠測・未取得） */
  missing: CoverageResult[];
  /** 様子見の機関（遅延） */
  delayed: CoverageResult[];
};

/** expected_freq を想定間隔（日）に直す。知らない値は基準なし扱いにする（推測しない）。 */
export function expectedIntervalDays(freq: string | null): number | null {
  if (freq === null) return null;
  const days = EXPECTED_FREQ_DAYS[freq.trim()];
  return days ?? null;
}

/** 1機関の状態を判定する。 */
export function evaluateAgencyCoverage(agency: CoverageAgency, now: Date): CoverageResult {
  const allowedDays = expectedIntervalDays(agency.expectedFreq);
  const base = { ...agency, allowedDays };

  if (allowedDays === null) {
    return { ...base, status: "基準なし", daysSince: null };
  }
  if (agency.lastSuccessAt === null) {
    return { ...base, status: "未取得", daysSince: null };
  }

  const last = new Date(agency.lastSuccessAt);
  if (Number.isNaN(last.getTime())) {
    // 日時として読めない値は、取れていないものとして扱う（推測で正常にしない）
    return { ...base, status: "未取得", daysSince: null };
  }

  const daysSince = (now.getTime() - last.getTime()) / 86_400_000;
  if (daysSince <= allowedDays) return { ...base, status: "正常", daysSince };
  if (daysSince <= allowedDays * 2) return { ...base, status: "遅延", daysSince };
  return { ...base, status: "欠測", daysSince };
}

/** 機関の一覧を判定し、対応が要るものをまとめる。 */
export function evaluateCoverage(agencies: CoverageAgency[], now: Date): CoverageSummary {
  const results = agencies.map((a) => evaluateAgencyCoverage(a, now));
  const checked = results.filter((r) => r.status !== "基準なし");
  return {
    results,
    checked: checked.length,
    healthy: checked.filter((r) => r.status === "正常").length,
    missing: checked.filter((r) => r.status === "欠測" || r.status === "未取得"),
    delayed: checked.filter((r) => r.status === "遅延"),
  };
}
