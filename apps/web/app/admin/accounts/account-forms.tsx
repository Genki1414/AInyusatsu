"use client";

// 本部のアカウント発行・停止フォーム（タスク4-8の続き）。
//
// 【初期パスワードは一度だけ出す】
// DBには残していないため、この画面を離れると二度と見られない。
// 控え忘れたときは「パスワード再発行」で作り直す運用にする（作り直せば済むので、
// 保存しておくより安全）。伝えやすいようにコピーボタンを付ける。

import { useActionState, useState } from "react";
import { SUSPEND_REASONS } from "@ai-nyusatsu-bu/domain";
import { btnClass, Panel, Pill } from "@/components/ui";
import { CopyButton } from "@/components/CopyButton";
import { issueAccount, issueAdditionalAccount, updateAccount, type AccountActionState } from "./actions";

// "use server" のファイルからは async 関数しか export できないため、初期値はこちらに置く。
// 参照：https://nextjs.org/docs/messages/invalid-use-server-value
const EMPTY_STATE: AccountActionState = { error: null, message: null, password: null, email: null };

const input =
  "rounded border border-slate-300 bg-white px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-300";

/** 完了・失敗・初期パスワードの表示。3つのフォームで同じ形を使う。 */
function Result({ state }: { state: AccountActionState }) {
  if (state.error) {
    return (
      <p role="alert" className="text-xs leading-relaxed text-rose-700">
        {state.error}
      </p>
    );
  }
  if (!state.message) return null;
  return (
    <div className="space-y-1">
      <p className="text-xs leading-relaxed text-emerald-800">{state.message}</p>
      {state.password && (
        <div className="rounded border border-amber-300 bg-amber-50 px-2 py-1.5">
          <p className="text-xs text-amber-900">
            初期パスワード（この画面を離れると二度と表示されません）
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {state.email && <span className="font-mono text-xs text-slate-700">{state.email}</span>}
            <span className="font-mono text-sm font-semibold tracking-wider text-slate-900">{state.password}</span>
            <CopyButton value={state.password} label="初期パスワード" />
          </div>
        </div>
      )}
    </div>
  );
}

export function IssueForm() {
  const [state, formAction, pending] = useActionState(issueAccount, EMPTY_STATE);

  return (
    <Panel title="アカウントを発行する">
      <form action={formAction} className="space-y-2">
        <label className="flex flex-wrap items-center gap-2 text-xs">
          <span className="w-24 shrink-0 font-medium text-slate-700">会社名</span>
          <input type="text" name="org_name" required className={`${input} w-72`} />
        </label>
        <label className="flex flex-wrap items-center gap-2 text-xs">
          <span className="w-24 shrink-0 font-medium text-slate-700">担当者名</span>
          <input type="text" name="user_name" required className={`${input} w-48`} />
        </label>
        <label className="flex flex-wrap items-center gap-2 text-xs">
          <span className="w-24 shrink-0 font-medium text-slate-700">メールアドレス</span>
          <input type="email" name="email" required autoComplete="off" className={`${input} w-72`} />
        </label>
        <p className="text-xs leading-relaxed text-slate-500">
          メールアドレスがそのままログインIDになります。会社名は協力会社へ送るメールの差出人名に使われます。
          発行しても本人には通知されません。表示された初期パスワードを、本部から本人へお伝えください。
        </p>
        <Result state={state} />
        <button type="submit" disabled={pending} className={btnClass("primary")}>
          {pending ? "発行中..." : "発行する"}
        </button>
      </form>
    </Panel>
  );
}

export type AccountRow = {
  orgId: string;
  orgName: string;
  status: string;
  suspendedReason: string | null;
  /** 代表のログイン。パスワード再発行の対象 */
  userId: string | null;
  userName: string | null;
  email: string | null;
  createdAt: string | null;
};

/** 定型に無い理由を書くときに選ぶ値。空文字にすると select の初期選択と紛れる */
const OTHER = "__other__";

export function AccountRowForms({ row }: { row: AccountRow }) {
  const [state, formAction, pending] = useActionState(updateAccount, EMPTY_STATE);
  // 停止のほとんどは未入金なので、それを既定で選んでおく
  const [reason, setReason] = useState<string>(SUSPEND_REASONS[0]);
  const active = row.status === "利用中";

  return (
    <div className="space-y-1.5 border-b border-slate-100 py-2 last:border-0">
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone={active ? "green" : "rose"}>{row.status}</Pill>
        <span className="text-xs font-medium text-slate-800">{row.orgName}</span>
        {/* 同じ会社名で複数のアカウントが並ぶことがあるため、担当者名で見分けられるようにする */}
        <span className="text-xs text-slate-700">{row.userName ?? "（担当者名なし）"}</span>
        <span className="text-xs text-slate-500">{row.email ?? "（ログイン未作成）"}</span>
      </div>
      {!active && row.suspendedReason && (
        <p className="text-xs text-slate-500">停止の理由：{row.suspendedReason}</p>
      )}

      <div className="flex flex-wrap items-end gap-2">
        {active ? (
          <form action={formAction} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="org_id" value={row.orgId} />
            <input type="hidden" name="op" value="停止" />
            <label className="flex flex-col gap-0.5 text-xs">
              <span className="text-slate-500">停止の理由（本人の画面に表示されます）</span>
              <select
                name="reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                className={`${input} w-72`}
              >
                {SUSPEND_REASONS.map((preset) => (
                  <option key={preset} value={preset}>
                    {preset}
                  </option>
                ))}
                <option value={OTHER}>その他（自分で書く）</option>
              </select>
            </label>
            {reason === OTHER && (
              <label className="flex flex-col gap-0.5 text-xs">
                <span className="text-slate-500">理由を書く</span>
                <input type="text" name="reason_other" required className={`${input} w-72`} />
              </label>
            )}
            <button type="submit" disabled={pending} className={btnClass("default", "sm")}>
              停止する
            </button>
          </form>
        ) : (
          <form action={formAction}>
            <input type="hidden" name="org_id" value={row.orgId} />
            <input type="hidden" name="op" value="再開" />
            <button type="submit" disabled={pending} className={btnClass("primary", "sm")}>
              再開する
            </button>
          </form>
        )}

        {row.userId && (
          <form action={formAction}>
            <input type="hidden" name="org_id" value={row.orgId} />
            <input type="hidden" name="op" value="パスワード再発行" />
            <input type="hidden" name="user_id" value={row.userId} />
            <input type="hidden" name="email" value={row.email ?? ""} />
            <button type="submit" disabled={pending} className={btnClass("default", "sm")}>
              パスワード再発行
            </button>
          </form>
        )}
      </div>

      <Result state={state} />
    </div>
  );
}

export type PendingRequest = {
  id: string;
  orgId: string;
  orgName: string;
  name: string;
  email: string;
  note: string | null;
  createdOn: string;
  /** 発行するとログインが何つになるか */
  loginsAfter: number;
  /** 発行後の追加料金（月・円） */
  monthlyAfter: number;
};

/**
 * アカウント追加の依頼一覧（本部）。
 *
 * 【一覧の上に出す】
 * 依頼は放置すると顧客が待たされる。発行フォームのすぐ下に置いて、
 * 開いたときに必ず目に入るようにする。件数が0なら何も出さない。
 *
 * 【発行するといくら増えるかを出す】
 * 押す前に金額が見えていないと、本部側でも請求の変化に気づけない。
 */
export function PendingRequests({ requests }: { requests: PendingRequest[] }) {
  const [state, formAction, pending] = useActionState(issueAdditionalAccount, EMPTY_STATE);
  if (requests.length === 0) return null;

  return (
    <Panel title={`アカウント追加の依頼（${requests.length}件）`}>
      <div className="space-y-2">
        {requests.map((request) => (
          <div key={request.id} className="border-b border-slate-100 pb-2 last:border-0 last:pb-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-slate-800">{request.orgName}</span>
              <span className="text-xs text-slate-700">{request.name}</span>
              <span className="text-xs text-slate-500">{request.email}</span>
              <span className="text-xs text-slate-400">{request.createdOn} 依頼</span>
            </div>
            {request.note && <p className="mt-0.5 text-xs text-slate-500">備考：{request.note}</p>}
            <div className="mt-1 flex flex-wrap items-center gap-2">
              {/* 発行すると請求が変わる。押す前に見えるようにする */}
              <span className="text-xs text-amber-700">
                発行するとログイン{request.loginsAfter}つ・追加料金 月
                {request.monthlyAfter.toLocaleString("ja-JP")}円
              </span>
              <form action={formAction}>
                <input type="hidden" name="request_id" value={request.id} />
                <button type="submit" disabled={pending} className={btnClass("primary", "sm")}>
                  {pending ? "発行中..." : "発行する"}
                </button>
              </form>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2">
        <Result state={state} />
      </div>
      <p className="mt-1 text-xs leading-relaxed text-slate-500">
        既存の会社に2人目以降のログインを足します。新しい会社を作るときは上の「アカウントを発行する」から。
        初期パスワードは、本部から本人へお伝えください。
      </p>
    </Panel>
  );
}
