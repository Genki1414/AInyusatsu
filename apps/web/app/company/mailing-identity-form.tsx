"use client";

// 郵送名義（協力会社開拓の問い合わせフォームに載る送信元。T55の続き）。
//
// 協力会社開拓の問い合わせフォームには契約者本人の名義を載せる
// （AI入札部自身のアドレスにはしない。ユーザー決定 2026-08-28）。
// ここで入力すると、営業AI（eigyouAI）側の送信元テンプレートへ自動で反映される
// （apps/web/lib/sales_ai_sync.ts）。本部への手入力の依頼は要らない。

import { useActionState } from "react";
import { Panel } from "@/components/ui";
import { saveMailingIdentity, type MailingIdentityState } from "./actions";

const EMPTY: MailingIdentityState = { error: null, saved: false, syncNote: null };
const input =
  "rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-300";

export type MailingIdentityView = {
  lastName: string;
  firstName: string;
  lastNameKana: string;
  firstNameKana: string;
  postalCode: string;
  prefecture: string;
  city: string;
  block: string;
  building: string;
  phone: string;
  department: string;
  position: string;
};

export function MailingIdentityForm({ view }: { view: MailingIdentityView }) {
  const [state, formAction, pending] = useActionState(saveMailingIdentity, EMPTY);

  return (
    <form action={formAction}>
      <Panel title="郵送名義（協力会社開拓のフォーム送信元）">
        <p className="text-xs leading-relaxed text-slate-500">
          営業AIで協力会社を開拓するとき、問い合わせフォームにはここで入力した名義が載ります
          （見積依頼のメールとは別です。全項目任意で、入力すると営業AI側へ自動的に反映されます）。
        </p>

        <div className="mt-3 flex flex-wrap gap-3">
          <label className="flex flex-col gap-0.5 text-xs">
            <span className="font-medium text-slate-700">姓</span>
            <input type="text" name="last_name" defaultValue={view.lastName} maxLength={50} className={`${input} w-28`} />
          </label>
          <label className="flex flex-col gap-0.5 text-xs">
            <span className="font-medium text-slate-700">名</span>
            <input type="text" name="first_name" defaultValue={view.firstName} maxLength={50} className={`${input} w-28`} />
          </label>
          <label className="flex flex-col gap-0.5 text-xs">
            <span className="font-medium text-slate-700">姓（フリガナ）</span>
            <input type="text" name="last_name_kana" defaultValue={view.lastNameKana} maxLength={50} className={`${input} w-28`} />
          </label>
          <label className="flex flex-col gap-0.5 text-xs">
            <span className="font-medium text-slate-700">名（フリガナ）</span>
            <input type="text" name="first_name_kana" defaultValue={view.firstNameKana} maxLength={50} className={`${input} w-28`} />
          </label>
        </div>

        <div className="mt-3 flex flex-wrap gap-3">
          <label className="flex flex-col gap-0.5 text-xs">
            <span className="font-medium text-slate-700">郵便番号</span>
            <input type="text" name="postal_code" defaultValue={view.postalCode} placeholder="100-0001" maxLength={16} className={`${input} w-28`} />
          </label>
          <label className="flex flex-col gap-0.5 text-xs">
            <span className="font-medium text-slate-700">都道府県</span>
            <input type="text" name="prefecture" defaultValue={view.prefecture} maxLength={10} className={`${input} w-24`} />
          </label>
          <label className="flex flex-col gap-0.5 text-xs">
            <span className="font-medium text-slate-700">市区町村</span>
            <input type="text" name="city" defaultValue={view.city} maxLength={50} className={`${input} w-40`} />
          </label>
          <label className="flex flex-col gap-0.5 text-xs">
            <span className="font-medium text-slate-700">丁目番地</span>
            <input type="text" name="block" defaultValue={view.block} maxLength={50} className={`${input} w-32`} />
          </label>
          <label className="flex flex-col gap-0.5 text-xs">
            <span className="font-medium text-slate-700">建物名</span>
            <input type="text" name="building" defaultValue={view.building} maxLength={80} className={`${input} w-40`} />
          </label>
        </div>

        <div className="mt-3 flex flex-wrap gap-3">
          <label className="flex flex-col gap-0.5 text-xs">
            <span className="font-medium text-slate-700">電話番号</span>
            <input type="text" name="phone" defaultValue={view.phone} placeholder="03-1234-5678" maxLength={20} className={`${input} w-36`} />
          </label>
          <label className="flex flex-col gap-0.5 text-xs">
            <span className="font-medium text-slate-700">部署</span>
            <input type="text" name="department" defaultValue={view.department} maxLength={50} className={`${input} w-40`} />
          </label>
          <label className="flex flex-col gap-0.5 text-xs">
            <span className="font-medium text-slate-700">役職</span>
            <input type="text" name="position" defaultValue={view.position} maxLength={50} className={`${input} w-32`} />
          </label>
        </div>

        {state.error && (
          <p role="alert" className="mt-2 text-xs text-rose-700">
            {state.error}
          </p>
        )}
        {state.saved && (
          <p className="mt-2 text-xs text-emerald-700">
            保存しました。{state.syncNote}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="mt-3 rounded border border-blue-800 bg-blue-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-900 disabled:opacity-40"
        >
          {pending ? "保存中..." : "保存する"}
        </button>
      </Panel>
    </form>
  );
}
