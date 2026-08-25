"use client";

// 担当者名（ログイン中のユーザー）。協力会社へ送るメールの署名に使う。
//
// 新規登録で氏名を入れなかった場合、メールアドレスがそのまま名前として保存される
// （20260803000001_auth_signup_trigger.sql の既定値）。署名にアドレスが並んでしまうため、
// あとから直せるようにこの画面を置いている。
import { useActionState } from "react";
import { Panel, btnClass } from "@/components/ui";
import { saveUserName, type UserNameState } from "./actions";

const initialState: UserNameState = { error: null, saved: false };
const input = "rounded border border-slate-300 bg-white px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-300";

export function UserForm({ userName, userEmail }: { userName: string; userEmail: string }) {
  const [state, formAction, pending] = useActionState(saveUserName, initialState);

  return (
    <Panel title="担当者（ログイン中のアカウント）">
      <form action={formAction} className="space-y-2">
        <label className="flex flex-wrap items-center gap-2 text-xs">
          <span className="w-24 shrink-0 font-medium text-slate-700">氏名</span>
          <input type="text" name="user_name" defaultValue={userName} required className={`${input} w-64`} />
        </label>
        <p className="text-xs leading-relaxed text-slate-500">
          協力会社へ送るメールの署名に、会社名とあわせて表示されます。
        </p>

        <label className="flex flex-wrap items-center gap-2 text-xs">
          <span className="w-24 shrink-0 font-medium text-slate-700">ログインID</span>
          <span className="text-slate-600">{userEmail}</span>
        </label>

        {state.error && (
          <p role="alert" className="text-xs text-rose-700">
            {state.error}
          </p>
        )}
        {state.saved && <p className="text-xs text-emerald-700">保存しました。</p>}

        <div className="pt-1">
          <button type="submit" disabled={pending} className={btnClass("primary", "sm")}>
            {pending ? "保存中..." : "保存する"}
          </button>
        </div>
      </form>
    </Panel>
  );
}
