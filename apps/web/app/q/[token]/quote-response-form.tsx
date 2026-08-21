"use client";

import { useActionState, useState } from "react";
import { submitQuoteResponse, type QuoteResponseState } from "./actions";

const initialState: QuoteResponseState = { error: null, saved: false };
const input =
  "mt-1 block w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-300";

export function QuoteResponseForm({
  token,
  partnerName,
  current,
}: {
  token: string;
  partnerName: string | null;
  current: { amount: number | null; declined: boolean; memo: string | null; repliedAt: string | null };
}) {
  const boundAction = submitQuoteResponse.bind(null, token);
  const [state, formAction, pending] = useActionState(boundAction, initialState);
  const [choice, setChoice] = useState<"quote" | "decline">(current.declined ? "decline" : "quote");
  const alreadyReplied = current.repliedAt !== null;

  return (
    <section className="rounded border border-slate-200 bg-white p-4">
      {partnerName && <p className="text-sm text-slate-600">{partnerName} 様</p>}
      {(alreadyReplied || state.saved) && (
        <p className="mt-1 rounded bg-emerald-50 px-2 py-1.5 text-sm text-emerald-800">
          {state.saved ? "送信しました。ありがとうございます。" : "この案件はすでにご回答いただいています。内容を修正して再送信することもできます。"}
        </p>
      )}

      <form action={formAction} className="mt-3 space-y-3">
        <div className="flex gap-4 text-sm text-slate-700">
          <label className="flex items-center gap-1.5">
            <input type="radio" name="choice" value="quote" checked={choice === "quote"} onChange={() => setChoice("quote")} />
            見積もる
          </label>
          <label className="flex items-center gap-1.5">
            <input type="radio" name="choice" value="decline" checked={choice === "decline"} onChange={() => setChoice("decline")} />
            今回は見送る
          </label>
        </div>

        {choice === "quote" && (
          <label className="block text-sm">
            <span className="text-slate-700">見積金額（円）</span>
            <input
              type="number"
              name="amount"
              min={1}
              step={1}
              defaultValue={current.amount ?? ""}
              required
              className={`${input} w-48`}
            />
          </label>
        )}

        <label className="block text-sm">
          <span className="text-slate-700">備考（任意）</span>
          <textarea name="memo" rows={3} defaultValue={current.memo ?? ""} className={input} />
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
