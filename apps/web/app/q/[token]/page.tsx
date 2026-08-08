// 協力会社の回答ページ（タスク4-2）。ログイン不要。
// 認証済みユーザーのセッションが無いため、他のページと違いRLS（ユーザーセッション）ではなく
// service_roleで取得し、URLのtoken一致だけを根拠にアクセスを絞る
// （tokenはquotesの行ごとに発行する推測不可能な値。lib/rematch.tsのコメント同様、
// このページに限りservice_roleの使用が前提になる）。
import { notFound } from "next/navigation";
import { createServiceClient } from "@ai-nyusatsu-bu/db";
import { QuoteResponseForm } from "./quote-response-form";

export const metadata = { robots: { index: false, follow: false } };

type QuoteRow = {
  id: string;
  request_id: string;
  amount: number | null;
  declined: boolean;
  replied_at: string | null;
  memo: string | null;
  partners: { name: string } | { name: string }[] | null;
};

type AgencyRef = { name: string } | { name: string }[] | null;

type RequestRow = {
  trade: string;
  due_at: string | null;
  lot_ids: string[];
  tenders: ({ name: string; place: string | null; term_from: string | null; term_to: string | null; agencies: AgencyRef } | null) | Array<{
    name: string;
    place: string | null;
    term_from: string | null;
    term_to: string | null;
    agencies: AgencyRef;
  }>;
  organizations: { name: string } | { name: string }[] | null;
};

type LotRow = { line_no: number; item: string; spec: string | null; qty: number | string | null; unit: string | null };

// Supabaseのネストしたselectは、関係によってオブジェクトと配列のどちらでも返り得るため揃える
// （apps/web内の他ページのagencyName()と同じ理由。参照：tenders/[id]/page.tsx）。
function one<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export default async function QuoteResponsePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = createServiceClient();

  const { data: quote } = await supabase
    .from("quotes")
    .select("id, request_id, amount, declined, replied_at, memo, partners(name)")
    .eq("response_token", token)
    .maybeSingle<QuoteRow>();
  if (!quote) notFound();

  const { data: request } = await supabase
    .from("quote_requests")
    .select("trade, due_at, lot_ids, tenders(name, place, term_from, term_to, agencies(name)), organizations(name)")
    .eq("id", quote.request_id)
    .maybeSingle<RequestRow>();
  if (!request) notFound();

  const { data: lots } =
    request.lot_ids.length > 0
      ? await supabase.from("tender_lots").select("line_no, item, spec, qty, unit").in("id", request.lot_ids).order("line_no").returns<LotRow[]>()
      : { data: [] as LotRow[] };

  const partner = one(quote.partners);
  const tender = one(request.tenders);
  const agency = tender ? one(tender.agencies) : null;
  const org = one(request.organizations);
  const dueAtLabel = request.due_at ? new Date(request.due_at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" }) : "未確認";

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-4 p-6">
      <div>
        <p className="text-sm text-slate-500">{org?.name ?? "発注元企業"}からの見積依頼</p>
        <h1 className="mt-1 text-xl font-semibold text-slate-800">{tender?.name ?? "案件名未確認"}</h1>
      </div>

      <section className="rounded border border-slate-200 bg-white p-4 text-sm text-slate-700">
        <dl className="space-y-1.5">
          <div className="flex gap-2">
            <dt className="w-24 shrink-0 text-slate-500">発注機関</dt>
            <dd>{agency?.name ?? "未確認"}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-24 shrink-0 text-slate-500">業種</dt>
            <dd>{request.trade}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-24 shrink-0 text-slate-500">履行場所</dt>
            <dd>{tender?.place ?? "未確認"}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-24 shrink-0 text-slate-500">履行期間</dt>
            <dd>
              {tender?.term_from ?? "未確認"} 〜 {tender?.term_to ?? "未確認"}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-24 shrink-0 text-slate-500">回答期限</dt>
            <dd className="font-medium text-blue-800">{dueAtLabel}</dd>
          </div>
        </dl>

        {lots && lots.length > 0 && (
          <div className="mt-3 border-t border-slate-100 pt-3">
            <div className="text-xs font-medium text-slate-500">対象範囲</div>
            <ul className="mt-1 space-y-0.5">
              {lots.map((l) => (
                <li key={l.line_no}>
                  {l.line_no}. {l.item}
                  {l.spec ? `（${l.spec}）` : ""} {l.qty != null ? `${l.qty}${l.unit ?? ""}` : ""}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <QuoteResponseForm
        token={token}
        partnerName={partner?.name ?? null}
        current={{ amount: quote.amount, declined: quote.declined, memo: quote.memo, repliedAt: quote.replied_at }}
      />
    </main>
  );
}
