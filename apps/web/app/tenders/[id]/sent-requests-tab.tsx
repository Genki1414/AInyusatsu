// 送信済みの見積依頼と、協力会社からの回答状況（未回答／見送り／資料請求）の一覧。
// 見積依頼の送信フォームとは別タブにして、過去の依頼を振り返れるようにする。
// 表示のみ（インタラクションが無い）ためServer Componentのままでよい。
import { Panel, Pill } from "@/components/ui";

export type SentQuoteRequest = {
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
    partner: { name: string } | null;
  }[];
};

function quoteStatus(q: SentQuoteRequest["quotes"][number]): { label: string; tone: "slate" | "amber" | "rose" | "green" } {
  // 未回答でも、回答ページを開いたかどうかで打ち手が変わる
  // （届いていない／見られていない のか、見たうえで返事が無いのか）。
  if (!q.replied_at) return q.opened_at ? { label: "開封済み・未回答", tone: "amber" } : { label: "未開封", tone: "slate" };
  if (q.declined) return { label: "見送り", tone: "rose" };
  if (q.documents_requested) return { label: "資料請求", tone: "amber" };
  if (q.amount != null) return { label: `見積あり（${q.amount.toLocaleString("ja-JP")}円）`, tone: "green" };
  return { label: "回答あり", tone: "green" };
}

export function SentRequestsTab({ sentRequests }: { sentRequests: SentQuoteRequest[] }) {
  if (sentRequests.length === 0) {
    return (
      <Panel title="送信済みの見積依頼">
        <p className="text-xs text-slate-500">まだ見積依頼を送信していません。「見積依頼」タブから送信してください。</p>
      </Panel>
    );
  }
  return (
    <Panel title="送信済みの見積依頼">
      <div className="space-y-3">
        {sentRequests.map((req) => (
          <div key={req.id} className="rounded border border-slate-100 p-2">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
              <span className="font-medium text-slate-800">{req.trade}</span>
              <span>送信：{req.sent_at ? new Date(req.sent_at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" }) : "未確認"}</span>
              <span>回答期限：{req.due_at ? new Date(req.due_at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" }) : "未確認"}</span>
            </div>
            <ul className="mt-1.5 space-y-1">
              {req.quotes.map((q) => {
                const status = quoteStatus(q);
                return (
                  <li key={q.id} className="flex flex-wrap items-center gap-1.5 text-xs text-slate-700">
                    <span>{q.partner?.name ?? "（削除された協力会社）"}</span>
                    <Pill tone={status.tone}>{status.label}</Pill>
                    {q.documents_requested && !q.documents_sent_at && <Pill tone="rose">資料の自動送付に失敗（要対応）</Pill>}
                    {q.documents_sent_at && (
                      <span className="text-slate-400">
                        資料送付済み（{new Date(q.documents_sent_at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}）
                      </span>
                    )}
                    {q.opened_at && (
                      <span className="text-slate-400">
                        開封：{new Date(q.opened_at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}
                      </span>
                    )}
                    {q.memo && <span className="text-slate-400">備考：{q.memo}</span>}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </Panel>
  );
}
