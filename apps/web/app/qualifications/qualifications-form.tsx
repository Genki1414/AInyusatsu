"use client";

import { useActionState } from "react";
import { AreaCheckboxGroup, Panel } from "@/components/ui";
import { AREA_OPTIONS, ITEM_OPTIONS, PREFECTURE_OPTIONS, QUAL_CATEGORIES } from "@/lib/catalog";
import { saveQualifications, type QualificationsState } from "./actions";

export type QualificationsFormProfile = {
  qual_categories: string[];
  grades: Record<string, string>;
  items: string[];
  areas: string[];
  qual_valid_to: string | null;
};

const initialState: QualificationsState = { error: null, saved: false };
const checkbox = "flex items-center gap-1.5 rounded border border-slate-200 px-2 py-1 text-xs text-slate-700";
const input = "rounded border border-slate-300 bg-white px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-300";

export function QualificationsForm({ profile }: { profile: QualificationsFormProfile }) {
  const [state, formAction, pending] = useActionState(saveQualifications, initialState);

  return (
    <form action={formAction} className="space-y-3">
      <Panel title="全省庁統一資格">
        <div className="flex flex-wrap gap-3">
          {QUAL_CATEGORIES.map((c) => (
            <label key={c} className={checkbox}>
              <input type="checkbox" name="qual_categories" value={c} defaultChecked={profile.qual_categories.includes(c)} />
              {c}
            </label>
          ))}
        </div>

        <div className="mt-3 space-y-2">
          <div className="text-xs font-medium text-slate-700">等級</div>
          {QUAL_CATEGORIES.map((c) => (
            <label key={c} className="flex items-center gap-2 text-xs text-slate-600">
              <span className="w-28 shrink-0">{c}</span>
              <input
                type="text"
                name={`grade_${c}`}
                defaultValue={profile.grades[c] ?? ""}
                placeholder="例：B"
                className={`${input} w-24`}
              />
            </label>
          ))}
        </div>

        <label className="mt-3 flex items-center gap-2 text-xs text-slate-600">
          有効期限
          <input type="date" name="qual_valid_to" defaultValue={profile.qual_valid_to ?? ""} className={input} />
        </label>
        <p className="mt-1 text-xs text-slate-400">資格の有効期間は3年度単位です。期限が切れると入札に参加できなくなります。</p>
      </Panel>

      <Panel title="営業品目" right={<span className="text-xs text-slate-400">登録していない品目の案件には参加できません</span>}>
        <div className="flex flex-wrap gap-2">
          {ITEM_OPTIONS.map((i) => (
            <label key={i} className={checkbox}>
              <input type="checkbox" name="items" value={i} defaultChecked={profile.items.includes(i)} />
              {i}
            </label>
          ))}
        </div>
      </Panel>

      <Panel title="競争参加地域">
        <AreaCheckboxGroup name="areas" options={[...AREA_OPTIONS, ...PREFECTURE_OPTIONS]} selected={profile.areas} />
      </Panel>

      {state.error && (
        <p role="alert" className="text-xs text-rose-700">
          {state.error}
        </p>
      )}
      {state.saved && <p className="text-xs text-emerald-700">保存しました。提案された案件を再照合しました。</p>}

      <button
        type="submit"
        disabled={pending}
        className="rounded border border-blue-800 bg-blue-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-900 disabled:opacity-40"
      >
        {pending ? "保存中..." : "保存する"}
      </button>
    </form>
  );
}
