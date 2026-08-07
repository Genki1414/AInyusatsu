// 案件詳細。docs/ai-nyusatsu-bu-prototype-v7.jsx の Detail 相当。
//
// プロトタイプのタブは 進め方／参加判断／資料／公告の中身／質問／見積依頼／見積・原価／
// 提出書類／結果 の9つだが、進め方以降の多くは見積依頼（タスク4-1）・原価集計（タスク4-5）
// に依存するため、このタスク（3-3）では 参加判断（適合）・資料・公告の中身（解析） の
// 3タブのみを実装する。進め方タブは、その土台となるジョブが揃ってから別タスクで追加する。
import { AlertTriangle, FileText, Sparkles, Target } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { CollectPill, Field, Panel, ProposePill } from "@/components/ui";
import { requireOrgContext } from "@/lib/auth";
import { AnalysisTab, type AnalysisTabAnalysis } from "./analysis-tab";
import { DOC_KINDS, DocsTab, type TenderDocumentRow, type TenderLotRow } from "./docs-tab";
import { FitTab, type FitTabProposal } from "./fit-tab";

type TenderRow = {
  id: string;
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
  collect_status: string;
  needs_review: boolean;
  review_reasons: string[];
  agencies: { name: string } | { name: string }[] | null;
};

const TABS = [
  { key: "fit", label: "参加判断", icon: Target },
  { key: "docs", label: "資料", icon: FileText },
  { key: "analysis", label: "公告の中身", icon: Sparkles },
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

  const { supabase, orgName } = await requireOrgContext();

  const [{ data: tender }, { data: documents }, { data: lots }, { data: analysis }, { data: proposal }] = await Promise.all([
    supabase
      .from("tenders")
      .select(
        "id, name, org_unit, notice_no, item, grade, areas, budget, qa_deadline, submit_deadline, bid_open_at, place, term_from, term_to, source_url, collect_status, needs_review, review_reasons, agencies(name)",
      )
      .eq("id", id)
      .maybeSingle<TenderRow>(),
    supabase
      .from("tender_documents")
      .select("kind, fetched, fetched_at, page_count, ocr_used")
      .eq("tender_id", id)
      .returns<TenderDocumentRow[]>(),
    supabase.from("tender_lots").select("line_no, item, spec, qty, unit, trade").eq("tender_id", id).order("line_no").returns<TenderLotRow[]>(),
    supabase
      .from("tender_analyses")
      .select("qualifications, conditions, notes, trades")
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
  ]);

  if (!tender) notFound();

  const gotDocs = DOC_KINDS.filter((kind) => (documents ?? []).some((d) => d.kind === kind && d.fetched)).length;

  return (
    <AppShell active="proposals" orgName={orgName}>
      <Link href="/proposals" className="text-xs text-slate-500 hover:underline">
        ← 一覧へ
      </Link>

      <Panel>
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-sm font-semibold leading-snug">{tender.name}</h1>
            <div className="mt-1 text-xs text-slate-500">
              {agencyName(tender.agencies)}
              {tender.org_unit && `／${tender.org_unit}`}
              {tender.notice_no && `／公告番号 ${tender.notice_no}`}
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
            {label === "資料" ? `資料（${gotDocs}/${DOC_KINDS.length}）` : label}
          </Link>
        ))}
      </div>

      {tab === "fit" && <FitTab proposal={proposal} />}
      {tab === "docs" && <DocsTab documents={documents ?? []} lots={lots ?? []} sourceUrl={tender.source_url} />}
      {tab === "analysis" && (
        <AnalysisTab tender={{ item: tender.item, grade: tender.grade, areas: tender.areas, place: tender.place }} analysis={analysis} />
      )}
    </AppShell>
  );
}
