"use client";

// 会社名の設定。協力会社へ送るメール（挨拶・署名）と画面のヘッダーに使われるため、
// 新規登録時の値をあとから直せるようにする。
// 新規登録で会社名が入らなかった場合はメールアドレスが入っている（handle_new_userの
// フォールバック）ので、そのままだと協力会社へのメールに「〇〇@〜でございます」と出てしまう。
import { useActionState } from "react";
import { Panel } from "@/components/ui";
import { saveCompanyName, type CompanyNameState } from "./actions";

const initialState: CompanyNameState = { error: null, saved: false };
const input = "rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-300";

export function CompanyForm({ orgName }: { orgName: string }) {
  const [state, formAction, pending] = useActionState(saveCompanyName, initialState);

  return (
    <form action={formAction}>
      <Panel title="御社の情報">
        <label className="flex flex-wrap items-center gap-2 text-xs">
          <span className="w-24 shrink-0 font-medium text-slate-700">会社名</span>
          <input type="text" name="org_name" defaultValue={orgName} required maxLength={100} className={`${input} w-72`} />
        </label>
        <p className="mt-1 text-xs text-slate-400">
          協力会社へ送る見積依頼・資料送付メールの挨拶と署名に使われます。
        </p>

        {state.error && (
          <p role="alert" className="mt-2 text-xs text-rose-700">
            {state.error}
          </p>
        )}
        {state.saved && <p className="mt-2 text-xs text-emerald-700">保存しました。</p>}

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
