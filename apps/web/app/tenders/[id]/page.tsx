// 案件詳細。docs/ai-nyusatsu-bu-prototype-v7.jsx の Detail 相当。
//
// プロトタイプのタブは 進め方／参加判断／資料／公告の中身／質問／見積依頼／見積・原価／
// 提出書類／結果 の9つ。進め方・質問・見積比較・提出書類・結果は、原価集計（タスク4-5）や
// 質問案生成など未着手の機能に依存するため、引き続き含めない。見積依頼（タスク4-1）は
// tender_lots・partnersだけで実装できるためこのPRで追加する。
import { AlertTriangle, Calculator, ClipboardCheck, FileText, ListChecks, Send, Sparkles, Target } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  amountBand,
  buildChecklist,
  checklistProgress,
  classifyAgencyClass,
  documentAvailabilities,
  groupLotsByTrade,
  matchAwardsByName,
  MIN_PARTIAL_MATCH_LENGTH,
  REQUIRED_DOC_KINDS,
  stripFiscalYear,
  summarizeDocuments,
  type ChecklistForm,
  type DocumentCheck,
  type FormState,
  type MarketRate,
  type MatchedAward,
} from "@ai-nyusatsu-bu/domain";
import { AppShell } from "@/components/AppShell";
import { CopyButton } from "@/components/CopyButton";
import { CollectPill, Field, Panel, ProposePill } from "@/components/ui";
import { requireOrgContext } from "@/lib/auth";
import { loadSenderIdentity } from "@/lib/sender";
import { AnalysisTab, type AnalysisTabAnalysis } from "./analysis-tab";
import { DocsTab, type TenderDocumentRow, type TenderLotRow } from "./docs-tab";
import { CostTab, type CostTabQuote, type QuoteInboxMessage } from "./cost-tab";
import { FormsTab } from "./forms-tab";
import { FitTab, type FitTabProposal } from "./fit-tab";
import { getPartnerRecommendations, type PartnerRecommendationResult } from "./recommend";
import { RequestTab, type RequestTabPartner } from "./request-tab";
import { SentRequestsTab, type SentQuoteRequest } from "./sent-requests-tab";

type TenderRow = {
  id: string;
  agency_id: string | null;
  name: string;
  org_unit: string | null;
  notice_no: string | null;
  item: string | null;
  grade: string | null;
  areas: string[];
  budget: number | null;
  qa_deadline: string | null;
  submit_deadline: string | null;
  bid_open_at: string | null;
  place: string | null;
  term_from: string | null;
  term_to: string | null;
  source_url: string | null;
  connector_id: string | null;
  acquire_method: string;
  collect_status: string;
  needs_review: boolean;
  review_reasons: string[];
  // 資料が無い理由の判定に使う（CLAUDE.md 最重要の前提7）
  documents_checked_at: string | null;
  published_doc_kinds: string[] | null;
  documents_failure_code: string | null;
  documents_failure_reason: string | null;
  agencies: { name: string } | { name: string }[] | null;
};

type OfficialStatus = "未取得" | "申請中" | "取得済";

type OrgRates = { overhead_rate: number; profit_rate: number };

type CostQuoteRow = {
  id: string;
  amount: number | null;
  adopted: boolean;
  declined: boolean;
  replied_at: string | null;
  memo: string | null;
  partners: { name: string } | { name: string }[] | null;
  quote_requests: { trade: string } | { trade: string }[] | null;
};

/**
 * 同種案件の落札率を1件引く。market_rates は（営業品目・機関区分・金額帯・期間）で
 * 集計してあるため、どれか1つでも決まらなければ目安は出せない（推測で代用しない）。
 */
async function loadMarketRate(
  supabase: Awaited<ReturnType<typeof requireOrgContext>>["supabase"],
  item: string | null,
  agency: string,
  budget: number | null,
): Promise<MarketRate | null> {
  const agencyClass = classifyAgencyClass(agency);
  if (!item || !agencyClass || budget === null) return null;

  const { data } = await supabase
    .from("market_rates")
    .select("n, rate_avg")
    .eq("item", item)
    .eq("agency_class", agencyClass)
    .eq("amount_band", amountBand(budget))
    .eq("period_months", 24)
    .maybeSingle<{ n: number; rate_avg: number | null }>();
  if (!data || data.rate_avg === null) return null;
  return { rate: data.rate_avg, n: data.n };
}

/** 落札実績の候補を取る件数。多すぎると画面が読めないので、近い順に絞る。 */
const SIMILAR_AWARDS_LIMIT = 20;

/**
 * 過去の落札実績を案件名で探す（適合タブ）。
 *
 * 国の入札は予定価格を原則として事前公表しないため tenders.budget はほとんど null。
 * 「いくらくらいの案件か」が分からないと参加を判断できない。
 *
 * 落札実績オープンデータには予定価格・品目分類・調達機関名称の列が無く
 * （docs/reference/落札実績オープンデータ_列定義（推定）.md §1）、awards.item / agency_id は
 * 常に null。そのため機関や品目では照合できず、案件名で引くしかない。
 *
 * 実データの名称は揺れが大きい（施設名が毎回違い、「等」「外」「ほか」の有無も揺れる）ため、
 * 近さの判定は Postgres の trigram 検索（find_similar_awards）に任せる。
 * 年度の表記は毎年変わるので、外してから渡す。
 */
async function loadPastAwards(
  supabase: Awaited<ReturnType<typeof requireOrgContext>>["supabase"],
  tenderName: string,
): Promise<MatchedAward[]> {
  const query = stripFiscalYear(tenderName).trim();
  // 短すぎる名称で引くと関係ない案件を大量に拾う
  if (query.length < MIN_PARTIAL_MATCH_LENGTH) return [];

  const { data, error } = await supabase.rpc("find_similar_awards", {
    p_name: query,
    p_limit: SIMILAR_AWARDS_LIMIT,
  });
  if (error) {
    // 実績が出ないだけで案件画面は使える。握りつぶさずログには残す
    console.error(`[tenders] 落札実績の検索に失敗しました: ${error.message}`);
    return [];
  }

  const rows = (data ?? []) as {
    name: string | null;
    amount: number;
    opened_at: string | null;
    winner_name: string | null;
    similarity: number | null;
  }[];

  return matchAwardsByName(
    rows.map((a) => ({
      name: a.name,
      amount: a.amount,
      openedAt: a.opened_at,
      winnerName: a.winner_name,
      similarity: a.similarity,
    })),
    tenderName,
  );
}

/** 見積書の保存先。本部が取得した資料とは分けている（配ってよいものかが違う）。 */
const ATTACHMENT_BUCKET = process.env.QUOTE_ATTACHMENTS_BUCKET || "quote-attachments";

/** 添付を開くための署名付きURLの有効期間（秒）。画面を開いているあいだ足りればよい。 */
const ATTACHMENT_URL_TTL_SECONDS = 60 * 60;

type InboundRow = {
  id: string;
  quote_id: string | null;
  received_at: string;
  body: string;
  parsed_amount: number | null;
  status: string;
  attachments: { filename: string; storageKey: string }[] | null;
};

/**
 * 見積ごとに、届いた返信と添付（見積書）を集める。
 *
 * 添付は署名付きURLにして渡す。inbound_messages のRLSは自組織に絞っているので、
 * 他社の見積書が混ざることはない。
 */
async function loadInbox(
  supabase: Awaited<ReturnType<typeof requireOrgContext>>["supabase"],
  quoteIds: string[],
): Promise<Record<string, QuoteInboxMessage[]>> {
  if (quoteIds.length === 0) return {};

  const { data, error } = await supabase
    .from("inbound_messages")
    .select("id, quote_id, received_at, body, parsed_amount, status, attachments")
    .in("quote_id", quoteIds)
    .order("received_at", { ascending: false })
    .returns<InboundRow[]>();
  if (error) {
    // 返信が出ないだけで見積の画面は使える。握りつぶさずログには残す
    console.error(`[tenders] 受信した返信の取得に失敗しました: ${error.message}`);
    return {};
  }

  const byQuote: Record<string, QuoteInboxMessage[]> = {};
  for (const row of data ?? []) {
    if (!row.quote_id) continue;
    const attachments = await Promise.all(
      (row.attachments ?? []).map(async (a) => {
        const { data: signed } = await supabase.storage
          .from(ATTACHMENT_BUCKET)
          .createSignedUrl(a.storageKey, ATTACHMENT_URL_TTL_SECONDS, { download: a.filename });
        return { filename: a.filename, url: signed?.signedUrl ?? null };
      }),
    );
    (byQuote[row.quote_id] ??= []).push({
      id: row.id,
      receivedAt: row.received_at,
      body: row.body,
      parsedAmount: row.parsed_amount,
      status: row.status,
      attachments,
    });
  }
  return byQuote;
}

type SentQuoteRequestRow = {
  id: string;
  trade: string;
  due_at: string | null;
  sent_at: string | null;
  quotes: {
    id: string;
    amount: number | null;
    declined: boolean;
    documents_requested: boolean;
    documents_sent_at: string | null;
    opened_at: string | null;
    replied_at: string | null;
    memo: string | null;
    partners: { name: string } | { name: string }[] | null;
  }[];
};

const TABS = [
  { key: "fit", label: "参加判断", icon: Target },
  { key: "docs", label: "資料", icon: FileText },
  { key: "analysis", label: "公告の中身", icon: Sparkles },
  { key: "request", label: "見積依頼", icon: Send },
  { key: "quote-status", label: "見積状況", icon: ListChecks },
  { key: "cost", label: "見積・原価", icon: Calculator },
  { key: "forms", label: "提出書類", icon: ClipboardCheck },
] as const;
type TabKey = (typeof TABS)[number]["key"];

function agencyName(agencies: TenderRow["agencies"]) {
  if (!agencies) return "";
  return Array.isArray(agencies) ? (agencies[0]?.name ?? "") : agencies.name;
}

function yen(n: number | null) {
  return n == null ? "非公表" : "¥" + n.toLocaleString("ja-JP");
}

function due(iso: string | null) {
  if (!iso) return "未確認";
  const target = new Date(iso);
  if (Number.isNaN(target.getTime())) return "未確認";
  const d = Math.ceil((target.getTime() - Date.now()) / 86_400_000);
  const formatted = target.toLocaleString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit" });
  return d >= 0 ? `${formatted}（残${d}日）` : `${formatted}（終了）`;
}

export default async function TenderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const { tab: tabParam } = await searchParams;
  const tab: TabKey = TABS.some((t) => t.key === tabParam) ? (tabParam as TabKey) : "fit";

  const { supabase, orgId, orgName, userName, userEmail } = await requireOrgContext();

  const [
    { data: tender },
    { data: documents },
    { data: lots },
    { data: analysis },
    { data: proposal },
    { data: partners },
    { data: companyTender },
    { data: forms },
    { data: formStates },
  ] = await Promise.all([
    supabase
      .from("tenders")
      .select(
        "id, agency_id, name, org_unit, notice_no, item, grade, areas, budget, qa_deadline, submit_deadline, bid_open_at, place, term_from, term_to, source_url, connector_id, acquire_method, collect_status, needs_review, review_reasons, documents_checked_at, published_doc_kinds, documents_failure_code, documents_failure_reason, agencies(name)",
      )
      .eq("id", id)
      .maybeSingle<TenderRow>(),
    supabase
      .from("tender_documents")
      .select("kind, fetched, fetched_at, page_count, ocr_used, extract_error")
      .eq("tender_id", id)
      .returns<TenderDocumentRow[]>(),
    supabase.from("tender_lots").select("line_no, item, spec, qty, unit, trade").eq("tender_id", id).order("line_no").returns<TenderLotRow[]>(),
    supabase
      .from("tender_analyses")
      .select("qualifications, conditions, notes, trades, raw")
      .eq("tender_id", id)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle<NonNullable<AnalysisTabAnalysis>>(),
    supabase
      .from("proposals")
      .select("status, score, reasons_ok, reasons_ng, excluded_reason")
      .eq("tender_id", id)
      .order("score", { ascending: false })
      .limit(1)
      .maybeSingle<FitTabProposal & { status: string }>(),
    supabase.from("partners").select("id, name, base, email, trades, areas, rating, memo").eq("active", true).returns<RequestTabPartner[]>(),
    supabase
      .from("company_tenders")
      .select("official_status, work_status, bid_price")
      .eq("tender_id", id)
      .maybeSingle<{ official_status: OfficialStatus; work_status: string; bid_price: number | null }>(),
    supabase.from("tender_forms").select("id, name, source, required, note").eq("tender_id", id).returns<ChecklistForm[]>(),
    supabase
      .from("company_tender_forms")
      .select("form_id, state")
      .eq("tender_id", id)
      .returns<{ form_id: string; state: FormState }[]>(),
  ]);

  if (!tender) notFound();

  const officialStatus: OfficialStatus = companyTender?.official_status ?? "未取得";
  // 資料が無い理由（機関が出していない／取得失敗）を分けて判定する（CLAUDE.md 最重要の前提7）
  const documentCheck: DocumentCheck = {
    checkedAt: tender.documents_checked_at,
    publishedKinds: tender.published_doc_kinds ?? [],
    failureCode: tender.documents_failure_code,
  };
  const availabilities = documentAvailabilities(documents ?? [], documentCheck);
  const docSummary = summarizeDocuments(availabilities);

  // 提出書類チェックリスト（タスク4-6）。進み具合は企業ごと（company_tender_forms）。
  const checklist = buildChecklist(
    forms ?? [],
    Object.fromEntries((formStates ?? []).map((s) => [s.form_id, s.state])),
  );
  const checklistDone = checklistProgress(checklist);

  // 見積依頼先のAIおすすめ選定（ユーザーからの要望：タブを開いたら自動で推薦する）。
  // 正式取得が済んでいない・数量表が無い場合は送信自体ができないため計算しない。
  const tradeGroups = groupLotsByTrade(lots ?? []);
  const recommendations: Record<string, PartnerRecommendationResult | null> =
    tab === "request" && officialStatus === "取得済" && tradeGroups.length > 0
      ? await getPartnerRecommendations(supabase, orgId, id, tender.item, tender.place, tradeGroups, partners ?? [])
      : {};

  // 送信済みの見積依頼と、協力会社からの回答状況（見積状況タブに一覧表示する）。
  const { data: sentRequestRows } =
    tab === "quote-status"
      ? await supabase
          .from("quote_requests")
          .select("id, trade, due_at, sent_at, quotes(id, amount, declined, documents_requested, documents_sent_at, opened_at, replied_at, memo, partners(name))")
          .eq("tender_id", id)
          .order("sent_at", { ascending: false })
          .returns<SentQuoteRequestRow[]>()
      : { data: null };
  const sentRequests: SentQuoteRequest[] = (sentRequestRows ?? []).map((r) => ({
    id: r.id,
    trade: r.trade,
    due_at: r.due_at,
    sent_at: r.sent_at,
    quotes: r.quotes.map((q) => ({
      id: q.id,
      amount: q.amount,
      declined: q.declined,
      documents_requested: q.documents_requested,
      documents_sent_at: q.documents_sent_at,
      opened_at: q.opened_at,
      replied_at: q.replied_at,
      memo: q.memo,
      partner: Array.isArray(q.partners) ? (q.partners[0] ?? null) : q.partners,
    })),
  }));

  // 原価集計（タスク4-5）。見積・原価タブでだけ引く。
  const { data: costRows } =
    tab === "cost"
      ? await supabase
          .from("quotes")
          .select("id, amount, adopted, declined, replied_at, memo, partners(name), quote_requests!inner(trade, tender_id)")
          .eq("quote_requests.tender_id", id)
          .returns<CostQuoteRow[]>()
      : { data: null };
  const costQuotes: CostTabQuote[] = (costRows ?? []).map((q) => ({
    id: q.id,
    trade: (Array.isArray(q.quote_requests) ? q.quote_requests[0]?.trade : q.quote_requests?.trade) ?? "未判定",
    partnerName: (Array.isArray(q.partners) ? q.partners[0]?.name : q.partners?.name) ?? "協力会社",
    amount: q.amount,
    adopted: q.adopted,
    declined: q.declined,
    repliedAt: q.replied_at,
    memo: q.memo,
  }));

  // 協力会社から届いた返信（タスク4-3）。見積書は添付で届くことが多いので、
  // 見積の行から開けるようにする。署名付きURLはサーバー側でだけ作る。
  const inboxByQuote = tab === "cost" ? await loadInbox(supabase, costQuotes.map((q) => q.id)) : {};

  // 同種案件の落札率（勝てそうかの目安）。営業品目・機関区分・金額帯がそろわないと引けない。
  const marketRate = tab === "cost" ? await loadMarketRate(supabase, tender.item, agencyName(tender.agencies), tender.budget) : null;
  const pastAwards = tab === "fit" ? await loadPastAwards(supabase, tender.name) : [];

  // 依頼文のプレビューに出す連絡先は、実際に送るときと同じ「返信先」にする
  // （送信時は actions.ts が同じ値を使う）。ここだけ別の値だと、画面で見た文面と
  // 届く文面が食い違う。
  const sender = tab === "request" ? await loadSenderIdentity(supabase, orgId, orgName, userEmail) : null;

  const { data: org } =
    tab === "cost"
      ? await supabase.from("organizations").select("overhead_rate, profit_rate").eq("id", orgId).maybeSingle<OrgRates>()
      : { data: null };

  // 見積依頼の回答期限の目安：提出期限の3日前（datetime-local用にAsia/Tokyoのローカル表記へ）。
  let suggestedDueAt: string | null = null;
  if (tender.submit_deadline) {
    const target = new Date(tender.submit_deadline);
    if (!Number.isNaN(target.getTime())) {
      target.setDate(target.getDate() - 3);
      const parts = new Intl.DateTimeFormat("sv-SE", {
        timeZone: "Asia/Tokyo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).formatToParts(target);
      const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
      suggestedDueAt = `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
    }
  }

  return (
    <AppShell active="tenders" orgName={orgName}>
      <Link href="/proposals" className="text-xs text-slate-500 hover:underline">
        ← 一覧へ
      </Link>

      <Panel>
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-start gap-1.5">
              <h1 className="text-sm font-semibold leading-snug">{tender.name}</h1>
              <CopyButton value={tender.name} label="案件名" />
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
              <span>
                {agencyName(tender.agencies)}
                {tender.org_unit && `／${tender.org_unit}`}
                {tender.notice_no && `／公告番号 ${tender.notice_no}`}
              </span>
              {tender.notice_no && <CopyButton value={tender.notice_no} label="公告番号" />}
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              <CollectPill s={tender.collect_status} />
              {proposal && <ProposePill s={proposal.status} />}
            </div>
            {tender.needs_review && (
              <p className="mt-2 flex gap-1.5 text-xs text-amber-800">
                <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                <span>期限の確認が必要です：{tender.review_reasons.join("／")}</span>
              </p>
            )}
          </div>
          <dl className="w-full text-xs sm:w-72">
            <Field label="予定価格">{yen(tender.budget)}</Field>
            <Field label="質問期限">{due(tender.qa_deadline)}</Field>
            <Field label="提出期限">{due(tender.submit_deadline)}</Field>
            <Field label="開札">{due(tender.bid_open_at)}</Field>
            <Field label="履行期間">
              {tender.term_from ?? "未確認"} 〜 {tender.term_to ?? "未確認"}
            </Field>
          </dl>
        </div>
      </Panel>

      <div className="flex gap-1 overflow-x-auto">
        {TABS.map(({ key, label, icon: Icon }) => (
          <Link
            key={key}
            href={`/tenders/${id}?tab=${key}`}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-t border-b-2 px-3 py-2 text-xs ${
              tab === key ? "border-blue-800 bg-white font-semibold text-slate-900" : "border-transparent text-slate-500 hover:bg-white"
            }`}
          >
            <Icon size={13} />
            {label === "資料"
              ? `資料（${docSummary.fetched}/${REQUIRED_DOC_KINDS.length}）`
              : label === "提出書類" && checklistDone.total > 0
                ? `提出書類（${checklistDone.done}/${checklistDone.total}）`
                : label}
          </Link>
        ))}
      </div>

      {tab === "fit" && <FitTab proposal={proposal} pastAwards={pastAwards} />}
      {tab === "docs" && (
        <DocsTab
          availabilities={availabilities}
          documents={documents ?? []}
          documentsFailureReason={tender.documents_failure_reason}
          lots={lots ?? []}
          sourceUrl={tender.source_url}
          connectorId={tender.connector_id}
          tenderId={id}
          acquireMethod={tender.acquire_method}
          officialStatus={officialStatus}
        />
      )}
      {tab === "analysis" && (
        <AnalysisTab tender={{ item: tender.item, grade: tender.grade, areas: tender.areas, place: tender.place }} analysis={analysis} />
      )}
      {tab === "request" && (
        <RequestTab
          tenderId={id}
          senderOrgName={orgName}
          senderContactName={userName}
          senderContactEmail={sender?.replyTo ?? null}
          tenderName={tender.name}
          agencyName={agencyName(tender.agencies)}
          place={tender.place}
          termFrom={tender.term_from}
          termTo={tender.term_to}
          lots={lots ?? []}
          partners={partners ?? []}
          suggestedDueAt={suggestedDueAt}
          officialStatus={officialStatus}
          recommendations={recommendations}
        />
      )}
      {tab === "quote-status" && <SentRequestsTab sentRequests={sentRequests} />}
      {tab === "cost" && (
        <CostTab
          tenderId={id}
          quotes={costQuotes}
          rates={{ overheadRate: org?.overhead_rate ?? 0.12, profitRate: org?.profit_rate ?? 0.1 }}
          budget={tender.budget}
          item={tender.item}
          marketRate={marketRate}
          decidedBidPrice={companyTender?.bid_price ?? null}
          inboxByQuote={inboxByQuote}
        />
      )}
      {tab === "forms" && (
        <FormsTab
          tenderId={id}
          items={checklist}
          submitDeadline={tender.submit_deadline}
          workStatus={companyTender?.work_status ?? "募集開始"}
        />
      )}
    </AppShell>
  );
}
