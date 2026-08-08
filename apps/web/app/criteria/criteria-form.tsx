"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Panel } from "@/components/ui";
import { saveCriteriaSet, type CriteriaState } from "./actions";

export type CriteriaFormValues = {
  id: string | null;
  name: string;
  items: string[];
  areas: string[];
  keywords: string[];
  ng_words: string[];
  min_budget: number | null;
  max_budget: number | null;
  min_days: number;
  active: boolean;
};

const initialState: CriteriaState = { error: null, savedId: null };
const checkbox = "flex items-center gap-1.5 rounded border border-slate-200 px-2 py-1 text-xs text-slate-700";
const input = "rounded border border-slate-300 bg-white px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-300";

export function CriteriaForm({ values, itemOptions, areaOptions }: { values: CriteriaFormValues; itemOptions: readonly string[]; areaOptions: readonly string[] }) {
  const [state, formAction, pending] = useActionState(saveCriteriaSet, initialState);
  const router = useRouter();

  useEffect(() => {
    if (state.savedId && state.savedId !== values.id) {
      router.push(`/criteria?set=${state.savedId}`);
    }
  }, [state.savedId, values.id, router]);

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="id" value={values.id ?? ""} />

      <Panel title="照合条件">
        <label className="flex items-center gap-2 border-b border-slate-100 py-2 text-xs">
          <span className="w-24 shrink-0 font-medium text-slate-700">セット名</span>
          <input type="text" name="name" defaultValue={values.name} required className={`${input} w-72`} />
        </label>

        <div className="border-b border-slate-100 py-2.5">
          <div className="text-xs font-medium text-slate-700">営業品目</div>
          <div className="mt-0.5 text-xs text-slate-400">登録済みの品目だけ選べます</div>
          <div className="mt-2 flex flex-wrap gap-1">
            {itemOptions.map((i) => (
              <label key={i} className={checkbox}>
                <input type="checkbox" name="items" value={i} defaultChecked={values.items.includes(i)} />
                {i}
              </label>
            ))}
          </div>
        </div>

        <div className="border-b border-slate-100 py-2.5">
          <div className="text-xs font-medium text-slate-700">競争参加地域</div>
          <div className="mt-2 flex flex-wrap gap-1">
            {areaOptions.map((a) => (
              <label key={a} className={checkbox}>
                <input type="checkbox" name="areas" value={a} defaultChecked={values.areas.includes(a)} />
                {a}
              </label>
            ))}
          </div>
        </div>

        <label className="block border-b border-slate-100 py-2.5 text-xs">
          <span className="font-medium text-slate-700">キーワード</span>
          <span className="ml-2 text-xs text-slate-400">案件名・仕様書の本文を検索します（1行に1つ）</span>
          <textarea name="keywords" defaultValue={values.keywords.join("\n")} rows={3} className={`${input} mt-1 block w-full`} />
        </label>

        <label className="block border-b border-slate-100 py-2.5 text-xs">
          <span className="font-medium text-slate-700">除外キーワード</span>
          <span className="ml-2 text-xs text-slate-400">これを含む案件は提案しません（1行に1つ）</span>
          <textarea name="ng_words" defaultValue={values.ng_words.join("\n")} rows={3} className={`${input} mt-1 block w-full`} />
        </label>

        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 py-2.5 text-xs">
          <span className="w-24 shrink-0 font-medium text-slate-700">金額の範囲</span>
          <input type="number" name="min_budget" defaultValue={values.min_budget ?? ""} className={`${input} w-32 tabular-nums`} />
          <span>〜</span>
          <input type="number" name="max_budget" defaultValue={values.max_budget ?? ""} className={`${input} w-32 tabular-nums`} />
          <span className="text-slate-500">円</span>
        </div>

        <div className="flex items-center gap-2 border-b border-slate-100 py-2.5 text-xs">
          <span className="w-24 shrink-0 font-medium text-slate-700">提出期限までの残日数</span>
          <input type="number" name="min_days" defaultValue={values.min_days} className={`${input} w-20 tabular-nums`} />
          <span className="text-slate-500">日以上</span>
          <span className="text-slate-400">準備が間に合わない案件は提案しません</span>
        </div>

        <label className="flex items-center gap-2 py-2.5 text-xs">
          <input type="checkbox" name="active" defaultChecked={values.active} />
          <span className="font-medium text-slate-700">このセットで照合する</span>
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
            {pending ? "保存中..." : "条件を保存する"}
          </button>
          <span className="self-center text-xs text-slate-400">保存すると自動で再照合されます</span>
        </div>
      </Panel>
    </form>
  );
}
