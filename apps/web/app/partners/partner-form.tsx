"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Panel } from "@/components/ui";
import { TRADE_OPTIONS } from "@/lib/catalog";
import { savePartner, type PartnerState } from "./actions";

export type PartnerFormValues = {
  id: string | null;
  name: string;
  person: string | null;
  tel: string | null;
  email: string | null;
  base: string | null;
  trades: string[];
  areas: string[];
  rating: number | null;
  memo: string | null;
  active: boolean;
};

const initialState: PartnerState = { error: null, savedId: null };
const checkbox = "flex items-center gap-1.5 rounded border border-slate-200 px-2 py-1 text-xs text-slate-700";
const input = "rounded border border-slate-300 bg-white px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-300";

export function PartnerForm({ values }: { values: PartnerFormValues }) {
  const [state, formAction, pending] = useActionState(savePartner, initialState);
  const router = useRouter();

  useEffect(() => {
    if (state.savedId && state.savedId !== values.id) {
      router.push(`/partners?partner=${state.savedId}`);
    }
  }, [state.savedId, values.id, router]);

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="id" value={values.id ?? ""} />

      <Panel title={values.id ? "会社を編集" : "会社を追加"}>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="text-xs">
            <span className="block font-medium text-slate-700">会社名</span>
            <input type="text" name="name" defaultValue={values.name} required className={`${input} mt-1 w-full`} />
          </label>
          <label className="text-xs">
            <span className="block font-medium text-slate-700">担当者</span>
            <input type="text" name="person" defaultValue={values.person ?? ""} className={`${input} mt-1 w-full`} />
          </label>
          <label className="text-xs">
            <span className="block font-medium text-slate-700">電話</span>
            <input type="text" name="tel" defaultValue={values.tel ?? ""} className={`${input} mt-1 w-full`} />
          </label>
          <label className="text-xs">
            <span className="block font-medium text-slate-700">メール</span>
            <input type="email" name="email" defaultValue={values.email ?? ""} className={`${input} mt-1 w-full`} />
          </label>
          <label className="text-xs">
            <span className="block font-medium text-slate-700">所在地</span>
            <input type="text" name="base" defaultValue={values.base ?? ""} className={`${input} mt-1 w-full`} />
          </label>
          <label className="text-xs">
            <span className="block font-medium text-slate-700">評価（0〜5、任意）</span>
            <input type="number" name="rating" min={0} max={5} step={0.1} defaultValue={values.rating ?? ""} className={`${input} mt-1 w-full tabular-nums`} />
          </label>
        </div>

        <div className="mt-3 border-t border-slate-100 pt-2.5">
          <div className="text-xs font-medium text-slate-700">業種</div>
          <div className="mt-2 flex flex-wrap gap-1">
            {TRADE_OPTIONS.map((t) => (
              <label key={t} className={checkbox}>
                <input type="checkbox" name="trades" value={t} defaultChecked={values.trades.includes(t)} />
                {t}
              </label>
            ))}
          </div>
        </div>

        <label className="mt-3 block border-t border-slate-100 pt-2.5 text-xs">
          <span className="font-medium text-slate-700">対応エリア</span>
          <span className="ml-2 text-xs text-slate-400">1行に1つ（例：東京、千葉）</span>
          <textarea name="areas" defaultValue={values.areas.join("\n")} rows={2} className={`${input} mt-1 block w-full`} />
        </label>

        <label className="mt-3 block border-t border-slate-100 pt-2.5 text-xs">
          <span className="font-medium text-slate-700">メモ</span>
          <textarea name="memo" defaultValue={values.memo ?? ""} rows={2} className={`${input} mt-1 block w-full`} />
        </label>

        <label className="mt-3 flex items-center gap-2 text-xs">
          <input type="checkbox" name="active" defaultChecked={values.active} />
          <span className="font-medium text-slate-700">有効（見積依頼の候補にする）</span>
        </label>

        {state.error && (
          <p role="alert" className="mt-2 text-xs text-rose-700">
            {state.error}
          </p>
        )}

        <div className="flex flex-wrap gap-2 pt-3">
          <button
            type="submit"
            disabled={pending}
            className="rounded border border-blue-800 bg-blue-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-900 disabled:opacity-40"
          >
            {pending ? "保存中..." : "保存する"}
          </button>
        </div>
      </Panel>
    </form>
  );
}
