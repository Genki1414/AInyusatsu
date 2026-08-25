// 発注機関を「国 / 自治体 / 独立行政法人等 / 不明」に分類する。
// 参照：CLAUDE.md「全省庁統一資格で参加できる入札案件を収集・解析し」
//
// 【なぜ必要か】
// KKJは国の機関も自治体も区別せずに返す。対象外と決めてある案件（自治体・建設工事）に
// AI解析の費用（実測 約69円/件）を払わないよう、解析の前に落とす必要がある。
//
// 判定は packages/domain の classifyAgencyScope に置き、ここではDBの読み書きと集計だけを行う。
//
// 【先に見せてから書く】
// 名前だけで判定するので、外れることがある。書き換える前に分類結果と件数を出し、
// 「不明」の機関名も並べて、人が見て確かめられるようにする。

import { createServiceClient } from "@ai-nyusatsu-bu/db";
import {
  classifyAgencyScope,
  isSourceAgency,
  judgeQualificationScope,
  type GovScope,
  type ScopeVerdict,
} from "@ai-nyusatsu-bu/domain";

/** AI解析1件あたりの費用（実測）。見込み額の計算に使う。 */
const YEN_PER_ANALYSIS = 69;

/** 「不明」の機関名を何件まで出すか。直す手がかりにするため。 */
const UNKNOWN_SAMPLE_LIMIT = 30;

export type ClassifyAgenciesOptions = {
  /** 案件の集計を何日ぶんさかのぼるか */
  days: number;
  /** 書き戻す。付けなければ下見だけ */
  apply: boolean;
};

/** 独立行政法人等を対象に含めるか（INCLUDE_INCORPORATED_AGENCIES=true）。 */
export function includeIncorporatedFromEnv(raw: string | undefined = process.env.INCLUDE_INCORPORATED_AGENCIES): boolean {
  return raw?.trim().toLowerCase() === "true";
}

export type ClassifyAgenciesResult = {
  /** 機関の数（区分ごと） */
  agencies: Record<GovScope, number>;
  /** 分類できなかった機関の名前（手がかり用） */
  unknownNames: string[];
  /** 直近の案件の判定（区分ごとの件数） */
  tenders: Record<ScopeVerdict, number>;
  /** 対象外・未判定の理由ごとの件数 */
  reasons: Record<string, number>;
  /** 集計した日数と、その期間の案件数 */
  days: number;
  tenderTotal: number;
  /** 実際に案件が入っていた公告日の数（1日あたりの計算に使う） */
  activeDays: number;
  /** 1日あたりの対象件数と、そこから見込まれる月額 */
  targetPerDay: number;
  estimatedMonthlyYen: number;
  /** 書き換えた機関の数 */
  updated: number;
};

type AgencyRow = { id: string; name: string; gov_scope: string | null };
type TenderRow = { agency_id: string; procurement: string; notice_date: string | null };

export async function runClassifyAgencies(options: ClassifyAgenciesOptions): Promise<ClassifyAgenciesResult> {
  const client = createServiceClient();

  const { data: agencies, error } = await client.from("agencies").select("id, name, gov_scope").returns<AgencyRow[]>();
  if (error) throw new Error(`発注機関の取得に失敗しました: ${error.message}`);

  const scopeById = new Map<string, GovScope>();
  const counts: Record<GovScope, number> = { 国: 0, 自治体: 0, 独立行政法人等: 0, 不明: 0 };
  const unknownNames: string[] = [];
  const changed: { id: string; scope: GovScope }[] = [];

  for (const agency of agencies ?? []) {
    // 収集元（官公需情報ポータル・調達ポータル）は発注機関ではない。
    // 分類の対象に入れると「分類できなかった機関」に並び続け、本当の取りこぼしが埋もれる
    if (isSourceAgency(agency.id)) continue;
    const scope = classifyAgencyScope(agency.name);
    scopeById.set(agency.id, scope);
    counts[scope]++;
    if (scope === "不明" && unknownNames.length < UNKNOWN_SAMPLE_LIMIT) unknownNames.push(agency.name);
    if (agency.gov_scope !== scope) changed.push({ id: agency.id, scope });
  }

  // 直近の案件で、実際に何件が対象になるかを数える
  const since = new Date(Date.now() - options.days * 86_400_000).toISOString().slice(0, 10);
  const { data: tenders, error: tenderError } = await client
    .from("tenders")
    .select("agency_id, procurement, notice_date")
    .gte("notice_date", since)
    .returns<TenderRow[]>();
  if (tenderError) throw new Error(`案件の取得に失敗しました: ${tenderError.message}`);

  const includeIncorporated = includeIncorporatedFromEnv();
  const verdicts: Record<ScopeVerdict, number> = { 対象: 0, 対象外: 0, 未判定: 0 };
  const reasons: Record<string, number> = {};
  for (const tender of tenders ?? []) {
    const govScope = scopeById.get(tender.agency_id) ?? "不明";
    const decision = judgeQualificationScope({ govScope, procurement: tender.procurement }, { includeIncorporated });
    verdicts[decision.verdict]++;
    if (decision.verdict !== "対象") reasons[decision.reason] = (reasons[decision.reason] ?? 0) + 1;
  }

  const tenderTotal = (tenders ?? []).length;
  // 【なぜ日数で割らないか】
  // 収集はまだ手動で、公告日が飛び飛びに入っている。指定日数で割ると1日あたりを
  // 実際より小さく見積もり、費用を過小に見せてしまう。
  // 実際に案件が入っている公告日の数で割る。
  const noticeDates = new Set((tenders ?? []).map((t) => t.notice_date).filter((d): d is string => d !== null));
  const activeDays = Math.max(1, noticeDates.size);
  const targetPerDay = verdicts.対象 / activeDays;
  const estimatedMonthlyYen = Math.round(targetPerDay * YEN_PER_ANALYSIS * 30);

  let updated = 0;
  if (options.apply) {
    for (const { id, scope } of changed) {
      const { error: updateError } = await client.from("agencies").update({ gov_scope: scope }).eq("id", id);
      if (updateError) {
        // 1機関で失敗しても他は続ける。握りつぶさずログに残す
        console.error(`[classify_agencies] 分類の保存に失敗しました（agency=${id}）: ${updateError.message}`);
        continue;
      }
      updated++;
    }
  }

  return {
    agencies: counts,
    unknownNames,
    tenders: verdicts,
    reasons,
    days: options.days,
    tenderTotal,
    activeDays,
    targetPerDay,
    estimatedMonthlyYen,
    updated,
  };
}
