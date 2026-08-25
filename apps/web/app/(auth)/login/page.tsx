"use client";

import { useActionState } from "react";
import { login, type LoginState } from "./actions";

const initialState: LoginState = { error: null };

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(login, initialState);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 p-6">
      <h1 className="text-xl font-semibold text-slate-800">ログイン</h1>
      <form action={formAction} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm text-slate-700">
          メールアドレス
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            className="rounded border border-slate-300 px-3 py-2 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-slate-700">
          パスワード
          <input
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="rounded border border-slate-300 px-3 py-2 text-sm"
          />
        </label>
        {state.error && (
          <p role="alert" className="text-sm text-rose-700">
            {state.error}
          </p>
        )}
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-slate-800 px-3 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          {pending ? "ログイン中..." : "ログイン"}
        </button>
      </form>
      {/* 支払いは請求書払いのみで、アカウントは本部が発行する（ユーザー決定 2026-08-25）。
          自分で登録する導線は置かない。問い合わせ先が分からないと迷子になるため、案内だけ残す */}
      <p className="text-sm leading-relaxed text-slate-600">
        アカウントは運営が発行します。ご利用をご希望の方、ログインできない方は、担当者までご連絡ください。
      </p>
    </main>
  );
}
