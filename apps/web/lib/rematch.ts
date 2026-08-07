// 自組織のproposalsを再照合する（タスク3-4「条件を変えると再照合される」）。
// apps/worker/jobs/match_tenders.ts と同じロジック（packages/domain の evaluateFit）を
// 使うが、ここではservice_roleを使わず、ログイン中ユーザーのRLSが効いたクライアントで
// 自組織の範囲だけを対象にする（company_profiles/criteria_sets/partners/proposalsは
// RLSが自動でorg_idを絞るため、明示的なorg_id指定が無くても他組織のデータは触れない）。
//
// 実装はapps/worker側と重複するが、片方はservice_roleで全org一括、もう片方はRLSで
// 自org限定という前提が異なるため、無理に共通化していない。
import { evaluateFit, type FitCompanyProfile, type FitCriteriaSet, type FitTender } from "@ai-nyusatsu-bu/domain";
import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

const RESCORABLE_STATUSES = new Set(["提案対象", "配信済", "既読"]);
const EMPTY_PROFILE: FitCompanyProfile = { qualCategories: [], grades: {}, items: [], areas: [] };

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

type CriteriaSetRow = {
  id: string;
  items: string[] | null;
  areas: string[] | null;
  keywords: string[] | null;
  ng_words: string[] | null;
  ng_agencies: string[] | null;
  min_budget: number | null;
  max_budget: number | null;
  min_days: number;
};

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

export type RematchResult = { proposalsCreated: number; proposalsUpdated: number; proposalsSkipped: number };

export async function rematchOrgProposals(supabase: Supabase, orgId: string): Promise<RematchResult> {
  const now = new Date();

  const [{ data: tenders, error: tendersError }, { data: criteriaSets, error: criteriaError }, { data: profileRow }, { data: partnerRows }] =
    await Promise.all([
      supabase
        .from("tenders")
        .select("id, agency_id, qual_category, item, grade, areas, budget, submit_deadline, name")
        .eq("collect_status", "公開中")
        .returns<TenderRow[]>(),
      supabase
        .from("criteria_sets")
        .select("id, items, areas, keywords, ng_words, ng_agencies, min_budget, max_budget, min_days")
        .eq("active", true)
        .returns<CriteriaSetRow[]>(),
      supabase
        .from("company_profiles")
        .select("qual_categories, grades, items, areas")
        .eq("org_id", orgId)
        .maybeSingle<{ qual_categories: string[]; grades: Record<string, string>; items: string[]; areas: string[] }>(),
      supabase.from("partners").select("trades").eq("active", true).returns<{ trades: string[] | null }[]>(),
    ]);
  if (tendersError) throw new Error(`案件の取得に失敗しました: ${tendersError.message}`);
  if (criteriaError) throw new Error(`条件セットの取得に失敗しました: ${criteriaError.message}`);
  if (!tenders || tenders.length === 0 || !criteriaSets || criteriaSets.length === 0) {
    return { proposalsCreated: 0, proposalsUpdated: 0, proposalsSkipped: 0 };
  }

  const company: FitCompanyProfile = profileRow
    ? { qualCategories: profileRow.qual_categories ?? [], grades: profileRow.grades ?? {}, items: profileRow.items ?? [], areas: profileRow.areas ?? [] }
    : EMPTY_PROFILE;
  const partnerTrades = Array.from(new Set((partnerRows ?? []).flatMap((p) => p.trades ?? [])));

  const tenderIds = tenders.map((t) => t.id);
  const [{ data: docs }, { data: lots }, { data: existingProposals }] = await Promise.all([
    supabase
      .from("tender_documents")
      .select("tender_id, extracted_text")
      .in("tender_id", tenderIds)
      .eq("kind", "仕様書")
      .not("extracted_text", "is", null)
      .returns<{ tender_id: string; extracted_text: string }[]>(),
    supabase.from("tender_lots").select("tender_id, trade").in("tender_id", tenderIds).not("trade", "is", null).returns<{ tender_id: string; trade: string }[]>(),
    supabase
      .from("proposals")
      .select("id, tender_id, criteria_set_id, status")
      .in("tender_id", tenderIds)
      .in(
        "criteria_set_id",
        criteriaSets.map((c) => c.id),
      )
      .returns<{ id: string; tender_id: string; criteria_set_id: string; status: string }[]>(),
  ]);

  const specTextByTender = new Map<string, string>();
  for (const doc of docs ?? []) {
    const current = specTextByTender.get(doc.tender_id);
    specTextByTender.set(doc.tender_id, current ? `${current}\n${doc.extracted_text}` : doc.extracted_text);
  }
  const tradesByTender = new Map<string, string[]>();
  for (const row of lots ?? []) {
    const list = tradesByTender.get(row.tender_id) ?? [];
    if (!list.includes(row.trade)) list.push(row.trade);
    tradesByTender.set(row.tender_id, list);
  }
  const existingByKey = new Map<string, { id: string; status: string }>();
  for (const p of existingProposals ?? []) {
    existingByKey.set(`${p.tender_id}:${p.criteria_set_id}`, { id: p.id, status: p.status });
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
      const result = evaluateFit(fitTender, company, toFitCriteria(criteria), { partnerTrades, now });
      const key = `${tender.id}:${criteria.id}`;
      const existing = existingByKey.get(key);
      if (existing && !RESCORABLE_STATUSES.has(existing.status)) {
        skipped++;
        continue;
      }
      upsertRows.push({
        org_id: orgId,
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
    const { error } = await supabase.from("proposals").upsert(upsertRows, { onConflict: "org_id,tender_id,criteria_set_id" });
    if (error) throw new Error(`提案の保存に失敗しました: ${error.message}`);
  }

  return { proposalsCreated: created, proposalsUpdated: updated, proposalsSkipped: skipped };
}
