"use client";

import { useActionState, useState } from "react";
import { submitQuoteResponse, type QuoteResponseState } from "./actions";

const initialState: QuoteResponseState = { error: null, saved: false };
const input =
  "mt-1 block w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-300";

type Choice = "request_documents" | "decline";

export function QuoteResponseForm({
  token,
  partnerName,
  afterDue,
  current,
}: {
  token: string;
  partnerName: string | null;
  afterDue: boolean;
  current: {
    amount: number | null;
    declined: boolean;
    documentsRequested: boolean;
    documentsSentAt: string | null;
    memo: string | null;
    repliedAt: string | null;
  };
}) {
  const boundAction = submitQuoteResponse.bind(null, token);
  const [state, formAction, pending] = useActionState(boundAction, initialState);
  const [choice, setChoice] = useState<Choice>(current.declined ? "decline" : "request_documents");
  const alreadyReplied = current.repliedAt !== null;

  // 送信直後は、いま選んだ内容に応じた案内を出す（サーバーの最新状態が反映される前でも
  // 「資料を送った」ことが分かるようにするため）。
  const justSentDocuments = state.saved && choice === "request_documents";

  return (
    <section className="rounded border border-slate-200 bg-white p-4">
      {partnerName && <p className="text-sm text-slate-600">{partnerName} 様</p>}

      {current.amount != null && (
        <p className="mt-1 text-sm text-slate-600">
          見積金額：{current.amount.toLocaleString("ja-JP")}円（記録済み。金額の変更はメールでご連絡ください）
        </p>
      )}

      {state.saved && (
        <p className="mt-1 rounded bg-emerald-50 px-2 py-1.5 text-sm text-emerald-800">
          {justSentDocuments
            ? "送信しました。資料をメールでお送りしましたのでご確認ください。"
            : "送信しました。ありがとうございます。"}
        </p>
      )}

      {!state.saved && alreadyReplied && (
        <div className="mt-1 rounded bg-slate-50 px-2 py-1.5 text-sm text-slate-700">
          <p>
            {current.declined
              ? "「今回は見送る」として記録されています。"
              : "「資料をお願いする」として記録されています。"}
            内容を修正して再送信することもできます。
          </p>
          {current.documentsSentAt && (
            <p className="mt-0.5 text-xs text-slate-500">
              資料の送付済み（{new Date(current.documentsSentAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}）。
              リンクの期限が切れた場合は、もう一度「資料をお願いする」を送信すると新しいリンクをお送りします。
            </p>
          )}
        </div>
      )}

      {afterDue && !state.saved && (
        <p className="mt-1 rounded bg-amber-50 px-2 py-1.5 text-sm text-amber-800">
          回答期限を過ぎています。ご回答は引き続き送信できますが、間に合わない場合があります。
        </p>
      )}

      <form action={formAction} className="mt-3 space-y-3">
        <div className="flex gap-4 text-sm text-slate-700">
          <label className="flex items-center gap-1.5">
            <input
              type="radio"
              name="choice"
              value="request_documents"
              checked={choice === "request_documents"}
              onChange={() => setChoice("request_documents")}
            />
            資料をお願いする
          </label>
          <label className="flex items-center gap-1.5">
            <input type="radio" name="choice" value="decline" checked={choice === "decline"} onChange={() => setChoice("decline")} />
            今回は見送る
          </label>
        </div>

        {choice === "request_documents" && (
          <p className="text-xs text-slate-500">送信すると、この案件の資料のダウンロードリンクをメールでお送りします。</p>
        )}

        <label className="block text-sm">
          <span className="text-slate-700">備考（任意）</span>
          <textarea name="memo" rows={3} maxLength={2000} defaultValue={current.memo ?? ""} className={input} />
        </label>

        {state.error && (
          <p role="alert" className="text-sm text-rose-700">
            {state.error}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="rounded bg-blue-800 px-4 py-2 text-sm font-medium text-white hover:bg-blue-900 disabled:opacity-40"
        >
          {pending ? "送信中..." : "送信する"}
        </button>
      </form>
    </section>
  );
}
