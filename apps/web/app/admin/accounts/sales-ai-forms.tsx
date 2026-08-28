"use client";

// 本部が組織ごとに営業AIの接続を設定するフォーム（9月分：協力会社開拓）。
//
// 【たたんでおく】
// アカウント一覧の主目的は発行・停止で、営業AIの設定は契約したときに一度触るだけ。
// 開いたままにすると一覧が長くなり、停止すべき組織が下に埋もれる。
//
// 【APIキーは出さない】
// 保存済みかどうかと末尾4文字だけを見せる。入れ直すときは全部を入力してもらう。

import { useActionState } from "react";
import { salesAiSetupState, type SalesAiSetupState } from "@ai-nyusatsu-bu/domain";
import { btnClass } from "@/components/ui";
import {
  checkSalesAiConnection,
  saveSalesAiConnection,
  type SalesAiAdminState,
} from "./sales-ai-actions";

// "use server" のファイルからは async 関数しか export できないため、初期値はこちらに置く
// （apps/web/AGENTS.md「実際に踏んだ落とし穴」）
const EMPTY: SalesAiAdminState = { error: null, message: null, orgId: null };

const input =
  "rounded border border-slate-300 bg-white px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-300";

export type SalesAiAdminView = {
  baseUrl: string;
  /** 伏せ字。実物は画面に出さない */
  maskedApiKey: string;
  hasKey: boolean;
  tradeMapText: string;
  tradeCount: number;
  checkedAtLabel: string | null;
  checkError: string | null;
};

export const EMPTY_SALES_AI_VIEW: SalesAiAdminView = {
  baseUrl: "",
  maskedApiKey: "未設定",
  hasKey: false,
  tradeMapText: "",
  tradeCount: 0,
  checkedAtLabel: null,
  checkError: null,
};

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

/** 開かなくても状態が分かる見出し。設定が途中で止まっている組織に気づけるようにする。 */
const TONE: Record<SalesAiSetupState, string> = {
  未設定: "text-slate-400",
  対応表が空: "text-amber-700",
  未確認: "text-amber-700",
  確認に失敗: "text-rose-700",
  設定済み: "text-emerald-700",
};

function summary(view: SalesAiAdminView): { label: string; tone: string } {
  const state = salesAiSetupState({
    baseUrl: view.baseUrl,
    hasKey: view.hasKey,
    tradeCount: view.tradeCount,
    // 表示用の文字列しか持っていないが、あるかないかだけを見ている
    checkedAt: view.checkedAtLabel,
    checkError: view.checkError,
  });
  const label = state === "未設定" ? state : `${state}（対応 ${view.tradeCount}業種）`;
  return { label, tone: TONE[state] };
}

export function SalesAiRowForm({ orgId, view }: { orgId: string; view: SalesAiAdminView }) {
  const [saveState, saveAction, saving] = useActionState(saveSalesAiConnection, EMPTY);
  const [checkState, checkAction, checking] = useActionState(checkSalesAiConnection, EMPTY);
  const head = summary(view);

  // 1画面に複数組織が並ぶ。他の行の結果をここに出さない
  const mine = (state: SalesAiAdminState): SalesAiAdminState =>
    state.orgId === orgId ? state : EMPTY;

  return (
    <details className="mt-1">
      <summary className="cursor-pointer text-xs text-slate-500 hover:text-slate-700">
        営業AI連携 <span className={head.tone}>{head.label}</span>
      </summary>

      <div className="mt-1.5 space-y-2 rounded border border-slate-200 bg-slate-50 px-2 py-2">
        <form action={saveAction} autoComplete="off" className="space-y-2">
          <input type="hidden" name="org_id" value={orgId} />

          <label className="flex flex-wrap items-center gap-2 text-xs">
            <span className="w-24 shrink-0 font-medium text-slate-700">営業AIのURL</span>
            {/* autoComplete を付けないと、Chromeが「パスワード欄の隣のテキスト欄」を
                ログインIDだと判断して、保存済みのメールアドレスを入れてしまう（実機で発生）。
                url を明示して、ログインフォームではないと伝える */}
            <input
              type="url"
              name="base_url"
              defaultValue={view.baseUrl}
              placeholder="https://sales.example.com"
              required
              autoComplete="url"
              className={`${input} w-72`}
            />
          </label>

          <label className="flex flex-wrap items-center gap-2 text-xs">
            <span className="w-24 shrink-0 font-medium text-slate-700">APIキー</span>
            {/* off はChromeに無視されることが多い。new-password なら保存済みパスワードを入れてこない */}
            <input type="password" name="api_key" required autoComplete="new-password" className={`${input} w-72`} />
            {view.hasKey && <span className="font-mono text-xs text-slate-500">保存済み {view.maskedApiKey}</span>}
          </label>

          <label className="block text-xs">
            <span className="font-medium text-slate-700">業種の対応表</span>
            <textarea
              name="trade_map"
              defaultValue={view.tradeMapText}
              rows={5}
              placeholder={"電気 = denki\n清掃 = seisou"}
              className={`${input} mt-1 block w-full font-mono`}
            />
          </label>
          <p className="text-xs leading-relaxed text-slate-500">
            1行に1件、「この製品の業種 = 営業AIの業種コード」の形で書きます。
            <span className="text-amber-700">対応表に無い業種では、この組織は候補を探せません。</span>
            業種を指定せずに問い合わせると、その都道府県の全社が対象になってしまうためです。
            営業AIの業種コードは営業AIの管理画面で確認してください（一覧を返すAPIがまだありません）。
          </p>

          <Result state={mine(saveState)} />
          <button type="submit" disabled={saving} className={btnClass("primary", "sm")}>
            {saving ? "保存中..." : "保存する"}
          </button>
        </form>

        <div className="border-t border-slate-200 pt-2">
          <form action={checkAction} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="org_id" value={orgId} />
            <button type="submit" disabled={checking} className={btnClass("default", "sm")}>
              {checking ? "確認中..." : "つながるか確認する"}
            </button>
            {view.checkedAtLabel && (
              <span className={`text-xs ${view.checkError ? "text-rose-700" : "text-slate-500"}`}>
                最後の確認 {view.checkedAtLabel}（{view.checkError ? "失敗" : "成功"}）
              </span>
            )}
          </form>
          {/* 失敗の理由を隠さない。設定を直せば解決するものがほとんどなので、そのまま見せる */}
          {view.checkError && <p className="mt-1 text-xs leading-relaxed text-rose-700">{view.checkError}</p>}
          <div className="mt-1">
            <Result state={mine(checkState)} />
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
            確認では件数を見るだけの問い合わせを1回送ります。リストは作らず、送信もしません。
            実際の送信は、この組織の利用者が案件画面でボタンを押したときだけ行われます。
          </p>
        </div>
      </div>
    </details>
  );
}
