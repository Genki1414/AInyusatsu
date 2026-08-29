"use client";

// 本部側の営業AI（eigyouAI）接続設定フォーム（T55の続き）。
// apps/web/app/admin/accounts/account-forms.tsx と同じ形（1操作=1<form>、useActionState）。

import { useActionState, useState } from "react";
import { formatTradeMap, maskApiKey } from "@ai-nyusatsu-bu/domain";
import { btnClass, Pill } from "@/components/ui";
import {
  checkConnection,
  deleteConnection,
  fetchTrades,
  provisionTenant,
  saveConnection,
  syncSenderIdentity,
  type SalesAiAdminState,
  type TradesState,
} from "./actions";

const EMPTY_STATE: SalesAiAdminState = { error: null, message: null };
const EMPTY_TRADES: TradesState = { error: null, trades: null };

const input =
  "rounded border border-slate-300 bg-white px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-300";
const textarea = `${input} w-full`;

function Result({ state }: { state: SalesAiAdminState }) {
  if (state.error) {
    return (
      <p role="alert" className="text-xs leading-relaxed text-rose-700">
        {state.error}
      </p>
    );
  }
  if (!state.message) return null;
  return <p className="text-xs leading-relaxed text-emerald-800">{state.message}</p>;
}

export type ConnectionRow = {
  orgId: string;
  orgName: string;
  baseUrl: string;
  apiKey: string | null;
  tenantId: number | null;
  tradeMap: Record<string, string>;
  checkedAt: string | null;
  checkError: string | null;
};

function jst(at: string | null): string {
  if (!at) return "—";
  const parsed = new Date(at);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
}

export function ConnectionRowForms({ row }: { row: ConnectionRow }) {
  const [manualOpen, setManualOpen] = useState(false);

  const [provState, provAction, provPending] = useActionState(provisionTenant, EMPTY_STATE);
  const [manState, manAction, manPending] = useActionState(saveConnection, EMPTY_STATE);
  const [delState, delAction, delPending] = useActionState(deleteConnection, EMPTY_STATE);
  const [chkState, chkAction, chkPending] = useActionState(checkConnection, EMPTY_STATE);
  const [syncState, syncAction, syncPending] = useActionState(syncSenderIdentity, EMPTY_STATE);
  const [tradesState, tradesAction, tradesPending] = useActionState(fetchTrades, EMPTY_TRADES);

  const connected = row.tenantId !== null;

  return (
    <div className="space-y-2 border-b border-slate-100 py-3 last:border-0">
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone={connected ? "green" : "rose"}>{connected ? "接続済み" : "未接続"}</Pill>
        <span className="text-xs font-medium text-slate-800">{row.orgName}</span>
        {connected && <span className="font-mono text-xs text-slate-500">テナントID {row.tenantId}</span>}
        {row.apiKey && <span className="font-mono text-xs text-slate-400">{maskApiKey(row.apiKey)}</span>}
      </div>

      {row.checkedAt && (
        <p className="text-xs text-slate-500">
          最終確認 {jst(row.checkedAt)}
          {row.checkError && <span className="text-rose-700">（失敗：{row.checkError}）</span>}
        </p>
      )}

      {!connected && (
        <form action={provAction} className="flex flex-wrap items-end gap-2 rounded border border-slate-200 bg-slate-50 p-2">
          <input type="hidden" name="org_id" value={row.orgId} />
          <label className="flex flex-col gap-0.5 text-xs">
            <span className="text-slate-500">会社名（協力会社への差出人名になる）</span>
            <input type="text" name="org_name" defaultValue={row.orgName} required className={`${input} w-56`} />
          </label>
          <label className="flex flex-col gap-0.5 text-xs">
            <span className="text-slate-500">送信元メールアドレス（契約者のアドレス）</span>
            <input type="email" name="sender_email" required autoComplete="off" className={`${input} w-64`} />
          </label>
          <button type="submit" disabled={provPending} className={btnClass("primary", "sm")}>
            {provPending ? "作成中..." : "営業AIにテナントを作る"}
          </button>
          <Result state={provState} />
        </form>
      )}

      {connected && (
        <div className="flex flex-wrap items-center gap-2">
          <form action={chkAction}>
            <input type="hidden" name="org_id" value={row.orgId} />
            <button type="submit" disabled={chkPending} className={btnClass("default", "sm")}>
              {chkPending ? "確認中..." : "つながるか確認する"}
            </button>
          </form>
          <form action={syncAction}>
            <input type="hidden" name="org_id" value={row.orgId} />
            <button type="submit" disabled={syncPending} className={btnClass("default", "sm")}>
              {syncPending ? "同期中..." : "送信元を今すぐ同期する"}
            </button>
          </form>
          <button type="button" onClick={() => setManualOpen((v) => !v)} className={btnClass("ghost", "sm")}>
            {manualOpen ? "手動設定を閉じる" : "接続を手で編集する"}
          </button>
        </div>
      )}
      <Result state={chkState} />
      <Result state={syncState} />
      {connected && (
        <p className="text-xs leading-relaxed text-slate-400">
          送信元（顧客名義）は、顧客が自社の「会社情報」画面を保存するたびに自動で反映されます。
          ここは自動同期が失敗したときのやり直し用です。
        </p>
      )}

      {(manualOpen || !connected) && (
        <details open={manualOpen || undefined} className="rounded border border-slate-200 p-2">
          <summary className="cursor-pointer text-xs font-medium text-slate-600">
            接続を手で設定する（既に営業AI側で発行済みのキーを貼るとき用）
          </summary>
          <form action={manAction} className="mt-2 space-y-2">
            <input type="hidden" name="org_id" value={row.orgId} />
            <label className="flex flex-wrap items-center gap-2 text-xs">
              <span className="w-24 shrink-0 font-medium text-slate-700">営業AIのURL</span>
              <input type="text" name="base_url" defaultValue={row.baseUrl} placeholder="https://ashibase.jp" required className={`${input} w-72`} />
            </label>
            <label className="flex flex-wrap items-center gap-2 text-xs">
              <span className="w-24 shrink-0 font-medium text-slate-700">APIキー</span>
              <input type="text" name="api_key" placeholder={row.apiKey ? "変更する場合のみ入力" : ""} required autoComplete="off" className={`${input} w-72`} />
            </label>
            <label className="flex flex-wrap items-center gap-2 text-xs">
              <span className="w-24 shrink-0 font-medium text-slate-700">テナントID（数値）</span>
              <input type="text" name="tenant_id" defaultValue={row.tenantId ?? ""} placeholder="分かれば入力" className={`${input} w-32`} />
            </label>
            <label className="flex flex-col gap-0.5 text-xs">
              <span className="font-medium text-slate-700">業種の対応表（1行1件「電気 = denki」）</span>
              <textarea name="trade_map" rows={4} defaultValue={formatTradeMap(row.tradeMap)} className={textarea} />
            </label>
            <button type="submit" disabled={manPending} className={btnClass("primary", "sm")}>
              {manPending ? "保存中..." : "保存する"}
            </button>
            <Result state={manState} />
          </form>
          {connected && (
            <div className="mt-2 border-t border-slate-100 pt-2">
              <form action={tradesAction}>
                <input type="hidden" name="org_id" value={row.orgId} />
                <button type="submit" disabled={tradesPending} className={btnClass("ghost", "sm")}>
                  {tradesPending ? "確認中..." : "業種コードを確認する"}
                </button>
              </form>
              {tradesState.error && <p className="mt-1 text-xs leading-relaxed text-rose-700">{tradesState.error}</p>}
              {tradesState.trades && (
                <ul className="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5 font-mono text-xs text-slate-700 sm:grid-cols-3">
                  {tradesState.trades.map((t) => (
                    <li key={t.code}>
                      {t.label} = {t.code}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {connected && (
            <form action={delAction} className="mt-2">
              <input type="hidden" name="org_id" value={row.orgId} />
              <button type="submit" disabled={delPending} className={btnClass("ghost", "sm")}>
                {delPending ? "削除中..." : "接続を削除する"}
              </button>
              <Result state={delState} />
            </form>
          )}
        </details>
      )}
    </div>
  );
}
