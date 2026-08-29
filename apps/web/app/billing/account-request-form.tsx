"use client";

// アカウント追加の依頼（顧客側）。
//
// 【なぜ「依頼」で止めるか】
// 追加するたびに月5,000円が発生する（docs/reference/価格.md）。
// 請求書払いなので、料金が増える操作を顧客が自分で完了できてはいけない。
// ここで作れるのは依頼だけで、発行するのは本部。
//
// 【いくら増えるかを押す前に出す】
// 「気づかないうちに人数が増えて請求が上がる」のがいちばん困る（価格.md）。
// いまのログイン数と、追加後の月額を、ボタンの手前に出す。

import { useActionState } from "react";
import {
  additionalLoginMonthlyYen,
  ADDITIONAL_LOGIN_MONTHLY_YEN,
  NOTE_MAX_LENGTH,
} from "@ai-nyusatsu-bu/domain";
import { btnClass, Panel, Pill } from "@/components/ui";
import { requestAccount, withdrawAccountRequest, type AccountRequestState } from "./account-request-actions";

// "use server" のファイルからは async 関数しか export できないため、初期値はこちらに置く
// （apps/web/AGENTS.md「実際に踏んだ落とし穴」）
const EMPTY: AccountRequestState = { error: null, message: null };

const input =
  "rounded border border-slate-300 bg-white px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-300";

export type AccountRequestView = {
  /** いま使えるログイン（users の行数） */
  logins: { name: string; email: string; isOwner: boolean }[];
  /** 依頼中のもの */
  pending: { id: string; name: string; email: string; createdOn: string }[];
};

function yen(value: number): string {
  return `${value.toLocaleString("ja-JP")}円`;
}

export function AccountRequestForm({ view }: { view: AccountRequestView }) {
  const [state, formAction, pending] = useActionState(requestAccount, EMPTY);
  const [withdrawState, withdrawAction, withdrawing] = useActionState(withdrawAccountRequest, EMPTY);
  const shown = withdrawState.error || withdrawState.message ? withdrawState : state;

  const current = view.logins.length;
  const now = additionalLoginMonthlyYen(current);
  const after = additionalLoginMonthlyYen(current + 1);

  return (
    <Panel title={`ログイン（${current}つ）`}>
      <ul className="space-y-1">
        {view.logins.map((login) => (
          <li key={login.email} className="flex flex-wrap items-center gap-2 text-xs">
            {login.isOwner && <Pill tone="slate">代表</Pill>}
            <span className="text-slate-800">{login.name}</span>
            <span className="text-slate-500">{login.email}</span>
          </li>
        ))}
      </ul>

      {/* 金額を先に出す。押したあとに知る、をさせない */}
      <p className="mt-2 text-xs leading-relaxed text-slate-600">
        追加ログインの料金は現在 <span className="font-medium text-slate-800">月 {yen(now)}</span> です
        （基本プランにログイン1つが含まれます。2つ目以降は1つあたり月 {yen(ADDITIONAL_LOGIN_MONTHLY_YEN)}）。
      </p>

      {view.pending.length > 0 && (
        <div className="mt-2 rounded border border-amber-200 bg-amber-50 px-2 py-1.5">
          <p className="text-xs font-medium text-amber-900">発行をお待ちいただいています</p>
          <ul className="mt-1 space-y-1">
            {view.pending.map((request) => (
              <li key={request.id} className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-slate-800">{request.name}</span>
                <span className="text-slate-500">{request.email}</span>
                <span className="text-slate-400">{request.createdOn} 依頼</span>
                <form action={withdrawAction}>
                  <input type="hidden" name="request_id" value={request.id} />
                  <button type="submit" disabled={withdrawing} className={btnClass("default", "sm")}>
                    取り下げる
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </div>
      )}

      <form action={formAction} className="mt-3 space-y-2 border-t border-slate-100 pt-3">
        <p className="text-xs font-medium text-slate-700">アカウントの追加を依頼する</p>

        <label className="flex flex-wrap items-center gap-2 text-xs">
          <span className="w-28 shrink-0 text-slate-600">お名前</span>
          <input type="text" name="name" required className={`${input} w-48`} />
        </label>
        <label className="flex flex-wrap items-center gap-2 text-xs">
          <span className="w-28 shrink-0 text-slate-600">メールアドレス</span>
          <input type="email" name="email" required autoComplete="off" className={`${input} w-72`} />
        </label>
        <label className="flex flex-wrap items-start gap-2 text-xs">
          <span className="w-28 shrink-0 pt-1 text-slate-600">備考（任意）</span>
          <input type="text" name="note" maxLength={NOTE_MAX_LENGTH} className={`${input} w-72`} />
        </label>

        <p className="text-xs leading-relaxed text-slate-500">
          メールアドレスがそのままログインIDになります。
          <span className="font-medium text-slate-700">
            発行されると、追加ログインの料金は月 {yen(after)} になります。
          </span>
          発行は運営が行い、初期パスワードは運営から直接お伝えします。
        </p>

        {shown.error && (
          <p role="alert" className="text-xs leading-relaxed text-rose-700">
            {shown.error}
          </p>
        )}
        {shown.message && <p className="text-xs leading-relaxed text-emerald-800">{shown.message}</p>}

        <button type="submit" disabled={pending} className={btnClass("primary")}>
          {pending ? "送信中..." : "追加を依頼する"}
        </button>
      </form>
    </Panel>
  );
}
