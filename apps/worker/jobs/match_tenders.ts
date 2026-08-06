// 提案の作成（match ジョブ、タスク3-2）。
// 参照：docs/実装仕様書_v1.md §7（提案エンジン）
//
// 「公開中」の案件すべてを、有効な条件セット（criteria_sets, active=true）ごとに
// packages/domain の evaluateFit で採点し、proposalsへ保存する。
//
// 再照合のルール（実装仕様書_v1.md §7「再照合：条件セット変更時に 提案対象 配信済 既読
// のみ作り直す」）に従い、既存のproposalsのうちstatusが 検討中／対象外 の行は
// ユーザーの判断が入った状態とみなし上書きしない。新規の組み合わせは常に作成する。
//
// 【スコープ外・別タスク】
// - 通知の送信（毎朝のダイジェスト・即時通知）は通知アダプタが無いため対象外
//   （実装仕様書_v1.md §8）。delivered_at / read_at はここでは更新しない

import { createServiceClient } from "@ai-nyusatsu-bu/db";
import { evaluateFit, type FitCompanyProfile, type FitCriteriaSet, type FitTender } from "@ai-nyusatsu-bu/domain";

const RESCORABLE_STATUSES = new Set(["提案対象", "配信済", "既読"]);

const EMPTY_PROFILE: FitCompanyProfile = { qualCategories: [], grades: {}, items: [], areas: [] };

export type MatchTendersResult = {
  tendersMatched: number;
  criteriaSetsMatched: number;
  proposalsCreated: number;
  proposalsUpdated: number;
  proposalsSkipped: number;
};

type TenderRow = {
  id: string;
  agency_id: string;
  qual_category: string | null;
  item: string | null;
  grade: string | null;
  areas: string[] | null;
  budget: number | null;
  submit_deadline: string | null;
  name: string;
};

type CompanyProfileRow = {
  org_id: string;
  qual_categories: string[] | null;
  grades: Record<string, string> | null;
  items: string[] | null;
  areas: string[] | null;
};

type CriteriaSetRow = {
  id: string;
  org_id: string;
  items: string[] | null;
  areas: string[] | null;
  keywords: string[] | null;
  ng_words: string[] | null;
  ng_agencies: string[] | null;
  min_budget: number | null;
  max_budget: number | null;
  min_days: number;
};

type PartnerRow = { org_id: string; trades: string[] | null };

type ProposalRow = { id: string; org_id: string; tender_id: string; criteria_set_id: string; status: string };

function groupBy<T, K>(rows: T[], key: (row: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const row of rows) {
    const k = key(row);
    const list = map.get(k);
    if (list) list.push(row);
    else map.set(k, [row]);
  }
  return map;
}

function toFitCriteria(row: CriteriaSetRow): FitCriteriaSet {
  return {
    items: row.items ?? [],
    areas: row.areas ?? [],
    keywords: row.keywords ?? [],
    ngWords: row.ng_words ?? [],
    ngAgencies: row.ng_agencies ?? [],
    minBudget: row.min_budget,
    maxBudget: row.max_budget,
    minDays: row.min_days,
  };
}

/** 公開中の案件すべてを、有効な条件セットごとに採点しproposalsへ保存する。 */
export async function runMatchTenders(now: Date = new Date()): Promise<MatchTendersResult> {
  const client = createServiceClient();

  const { data: tenders, error: tendersError } = await client
    .from("tenders")
    .select("id, agency_id, qual_category, item, grade, areas, budget, submit_deadline, name")
    .eq("collect_status", "公開中")
    .returns<TenderRow[]>();
  if (tendersError) throw new Error(`案件の取得に失敗しました: ${tendersError.message}`);
  if (!tenders || tenders.length === 0) {
    return { tendersMatched: 0, criteriaSetsMatched: 0, proposalsCreated: 0, proposalsUpdated: 0, proposalsSkipped: 0 };
  }
  const tenderIds = tenders.map((t) => t.id);

  const { data: criteriaSets, error: criteriaError } = await client
    .from("criteria_sets")
    .select("id, org_id, items, areas, keywords, ng_words, ng_agencies, min_budget, max_budget, min_days")
    .eq("active", true)
    .returns<CriteriaSetRow[]>();
  if (criteriaError) throw new Error(`条件セットの取得に失敗しました: ${criteriaError.message}`);
  if (!criteriaSets || criteriaSets.length === 0) {
    return { tendersMatched: tenders.length, criteriaSetsMatched: 0, proposalsCreated: 0, proposalsUpdated: 0, proposalsSkipped: 0 };
  }

  const { data: docs, error: docsError } = await client
    .from("tender_documents")
    .select("tender_id, extracted_text")
    .in("tender_id", tenderIds)
    .eq("kind", "仕様書")
    .not("extracted_text", "is", null)
    .returns<{ tender_id: string; extracted_text: string }[]>();
  if (docsError) throw new Error(`資料の取得に失敗しました: ${docsError.message}`);
  const specTextByTender = new Map<string, string>();
  for (const doc of docs ?? []) {
    const current = specTextByTender.get(doc.tender_id);
    specTextByTender.set(doc.tender_id, current ? `${current}\n${doc.extracted_text}` : doc.extracted_text);
  }

  const { data: lots, error: lotsError } = await client
    .from("tender_lots")
    .select("tender_id, trade")
    .in("tender_id", tenderIds)
    .not("trade", "is", null)
    .returns<{ tender_id: string; trade: string }[]>();
  if (lotsError) throw new Error(`数量表の取得に失敗しました: ${lotsError.message}`);
  const tradesByTender = new Map<string, string[]>();
  for (const [tenderId, rows] of groupBy(lots ?? [], (r) => r.tender_id)) {
    tradesByTender.set(tenderId, Array.from(new Set(rows.map((r) => r.trade))));
  }

  const orgIds = Array.from(new Set(criteriaSets.map((c) => c.org_id)));

  const { data: profiles, error: profilesError } = await client
    .from("company_profiles")
    .select("org_id, qual_categories, grades, items, areas")
    .in("org_id", orgIds)
    .returns<CompanyProfileRow[]>();
  if (profilesError) throw new Error(`企業プロファイルの取得に失敗しました: ${profilesError.message}`);
  const profileByOrg = new Map<string, FitCompanyProfile>();
  for (const p of profiles ?? []) {
    profileByOrg.set(p.org_id, {
      qualCategories: p.qual_categories ?? [],
      grades: p.grades ?? {},
      items: p.items ?? [],
      areas: p.areas ?? [],
    });
  }

  const { data: partners, error: partnersError } = await client
    .from("partners")
    .select("org_id, trades")
    .in("org_id", orgIds)
    .eq("active", true)
    .returns<PartnerRow[]>();
  if (partnersError) throw new Error(`協力会社の取得に失敗しました: ${partnersError.message}`);
  const partnerTradesByOrg = new Map<string, string[]>();
  for (const [orgId, rows] of groupBy(partners ?? [], (r) => r.org_id)) {
    const trades = new Set<string>();
    for (const row of rows) for (const trade of row.trades ?? []) trades.add(trade);
    partnerTradesByOrg.set(orgId, Array.from(trades));
  }

  const { data: existingProposals, error: existingError } = await client
    .from("proposals")
    .select("id, org_id, tender_id, criteria_set_id, status")
    .in("tender_id", tenderIds)
    .in(
      "criteria_set_id",
      criteriaSets.map((c) => c.id),
    )
    .returns<ProposalRow[]>();
  if (existingError) throw new Error(`既存の提案の取得に失敗しました: ${existingError.message}`);
  const existingByKey = new Map<string, ProposalRow>();
  for (const p of existingProposals ?? []) {
    existingByKey.set(`${p.org_id}:${p.tender_id}:${p.criteria_set_id}`, p);
  }

  const upsertRows: Record<string, unknown>[] = [];
  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const tender of tenders) {
    const fitTender: FitTender = {
      agencyId: tender.agency_id,
      qualCategory: tender.qual_category,
      item: tender.item,
      grade: tender.grade,
      areas: tender.areas ?? [],
      budget: tender.budget,
      submitDeadline: tender.submit_deadline,
      name: tender.name,
      specText: specTextByTender.get(tender.id) ?? "",
      trades: tradesByTender.get(tender.id) ?? [],
    };

    for (const criteria of criteriaSets) {
      const company = profileByOrg.get(criteria.org_id) ?? EMPTY_PROFILE;
      const partnerTrades = partnerTradesByOrg.get(criteria.org_id) ?? [];
      const result = evaluateFit(fitTender, company, toFitCriteria(criteria), { partnerTrades, now });

      const key = `${criteria.org_id}:${tender.id}:${criteria.id}`;
      const existing = existingByKey.get(key);
      if (existing && !RESCORABLE_STATUSES.has(existing.status)) {
        skipped++;
        continue;
      }

      upsertRows.push({
        org_id: criteria.org_id,
        tender_id: tender.id,
        criteria_set_id: criteria.id,
        status: result.eligible ? "提案対象" : "対象外",
        score: result.score,
        reasons_ok: result.reasonsOk,
        reasons_ng: result.reasonsNg,
        excluded_reason: result.excludedReason,
      });
      if (existing) updated++;
      else created++;
    }
  }

  if (upsertRows.length > 0) {
    const { error: upsertError } = await client
      .from("proposals")
      .upsert(upsertRows, { onConflict: "org_id,tender_id,criteria_set_id" });
    if (upsertError) throw new Error(`提案の保存に失敗しました: ${upsertError.message}`);
  }

  return {
    tendersMatched: tenders.length,
    criteriaSetsMatched: criteriaSets.length,
    proposalsCreated: created,
    proposalsUpdated: updated,
    proposalsSkipped: skipped,
  };
}
