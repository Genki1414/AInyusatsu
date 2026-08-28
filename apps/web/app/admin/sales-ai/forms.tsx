"use client";

// 本部側の営業AI（eigyouAI）接続設定フォーム（T55の続き）。
// apps/web/app/admin/accounts/account-forms.tsx と同じ形（1操作=1<form>、useActionState）。

import { useActionState, useState } from "react";
import { formatTradeMap, maskApiKey } from "@ai-nyusatsu-bu/domain";
import { btnClass, Pill } from "@/components/ui";
import {
  checkConnection,
  deleteConnection,
  provisionTenant,
  saveConnection,
  saveSenderIdentity,
  type SalesAiAdminState,
} from "./actions";

const EMPTY_STATE: SalesAiAdminState = { error: null, message: null };

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
  const [senderOpen, setSenderOpen] = useState(false);

  const [provState, provAction, provPending] = useActionState(provisionTenant, EMPTY_STATE);
  const [manState, manAction, manPending] = useActionState(saveConnection, EMPTY_STATE);
  const [delState, delAction, delPending] = useActionState(deleteConnection, EMPTY_STATE);
  const [chkState, chkAction, chkPending] = useActionState(checkConnection, EMPTY_STATE);
  const [sndState, sndAction, sndPending] = useActionState(saveSenderIdentity, EMPTY_STATE);

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
          <button type="button" onClick={() => setSenderOpen((v) => !v)} className={btnClass("default", "sm")}>
            送信元（顧客名義）を{senderOpen ? "閉じる" : "設定する"}
          </button>
          <button type="button" onClick={() => setManualOpen((v) => !v)} className={btnClass("ghost", "sm")}>
            {manualOpen ? "手動設定を閉じる" : "接続を手で編集する"}
          </button>
        </div>
      )}
      <Result state={chkState} />

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

      {senderOpen && connected && (
        <div className="rounded border border-slate-200 p-2">
          <p className="mb-2 text-xs leading-relaxed text-slate-500">
            協力会社開拓の問い合わせフォームに載る送信元。<strong>契約者本人の名義</strong>を入れる
            （AI入札部自身のアドレスにはしない）。姓・名・フリガナ・郵便番号・住所・電話番号は、
            別欄がある問い合わせフォーム向けの任意項目。
          </p>
          <form action={sndAction} className="space-y-2">
            <input type="hidden" name="org_id" value={row.orgId} />
            <div className="flex flex-wrap gap-2">
              <label className="flex flex-col gap-0.5 text-xs">
                <span className="text-slate-500">送信元名（会社名）</span>
                <input type="text" name="sender_name" defaultValue={row.orgName} required className={`${input} w-56`} />
              </label>
              <label className="flex flex-col gap-0.5 text-xs">
                <span className="text-slate-500">送信元メールアドレス</span>
                <input type="email" name="sender_email" required className={`${input} w-64`} />
              </label>
            </div>
            <label className="flex flex-col gap-0.5 text-xs">
              <span className="text-slate-500">住所（単一欄向け）</span>
              <input type="text" name="sender_address" className={`${input} w-full`} />
            </label>
            <div className="flex flex-wrap gap-2">
              <label className="flex flex-col gap-0.5 text-xs">
                <span className="text-slate-500">姓</span>
                <input type="text" name="last_name" className={`${input} w-24`} />
              </label>
              <label className="flex flex-col gap-0.5 text-xs">
                <span className="text-slate-500">名</span>
                <input type="text" name="first_name" className={`${input} w-24`} />
              </label>
              <label className="flex flex-col gap-0.5 text-xs">
                <span className="text-slate-500">姓（フリガナ）</span>
                <input type="text" name="last_name_kana" className={`${input} w-24`} />
              </label>
              <label className="flex flex-col gap-0.5 text-xs">
                <span className="text-slate-500">名（フリガナ）</span>
                <input type="text" name="first_name_kana" className={`${input} w-24`} />
              </label>
              <label className="flex flex-col gap-0.5 text-xs">
                <span className="text-slate-500">郵便番号</span>
                <input type="text" name="postal_code" className={`${input} w-24`} />
              </label>
            </div>
            <div className="flex flex-wrap gap-2">
              <label className="flex flex-col gap-0.5 text-xs">
                <span className="text-slate-500">都道府県</span>
                <input type="text" name="prefecture" className={`${input} w-24`} />
              </label>
              <label className="flex flex-col gap-0.5 text-xs">
                <span className="text-slate-500">市区町村</span>
                <input type="text" name="city" className={`${input} w-40`} />
              </label>
              <label className="flex flex-col gap-0.5 text-xs">
                <span className="text-slate-500">丁目番地</span>
                <input type="text" name="block" className={`${input} w-32`} />
              </label>
              <label className="flex flex-col gap-0.5 text-xs">
                <span className="text-slate-500">建物名</span>
                <input type="text" name="building" className={`${input} w-40`} />
              </label>
              <label className="flex flex-col gap-0.5 text-xs">
                <span className="text-slate-500">電話番号</span>
                <input type="text" name="phone" className={`${input} w-32`} />
              </label>
            </div>
            <div className="flex flex-wrap gap-2">
              <label className="flex flex-col gap-0.5 text-xs">
                <span className="text-slate-500">部署</span>
                <input type="text" name="department" className={`${input} w-40`} />
              </label>
              <label className="flex flex-col gap-0.5 text-xs">
                <span className="text-slate-500">役職</span>
                <input type="text" name="position" className={`${input} w-32`} />
              </label>
              <label className="flex flex-col gap-0.5 text-xs">
                <span className="text-slate-500">配信停止URL（任意）</span>
                <input type="text" name="optout_url" className={`${input} w-56`} />
              </label>
            </div>
            <button type="submit" disabled={sndPending} className={btnClass("primary", "sm")}>
              {sndPending ? "設定中..." : "送信元を設定・有効化する"}
            </button>
            <Result state={sndState} />
          </form>
        </div>
      )}
    </div>
  );
}
