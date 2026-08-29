"use client";

// 営業AI（eigyouAI）の接続設定。
//
// 協力会社がいない業種を、営業AIに登録されている企業から探すために使う。
// 探すのとリストを作るのは案件画面から。ここは接続の設定だけ。
//
// 送信はこの製品からは行わない（CLAUDE.md「やらないこと：問い合わせフォームへの自動送信」）。
// 作ったリストは営業AIの画面で確かめてから、人が送る。

import { useActionState } from "react";
import { btnClass, Panel } from "@/components/ui";
import { checkSalesAiConnection, fetchSalesAiTrades, saveSalesAiSettings, type SalesAiState, type TradesState } from "./sales-ai-actions";

// "use server" のファイルからは async 関数しか export できないため、初期値はこちらに置く
// （apps/web/AGENTS.md「実際に踏んだ落とし穴」）
const EMPTY: SalesAiState = { error: null, message: null };
const EMPTY_TRADES: TradesState = { error: null, trades: null };

const input = "rounded border border-slate-300 bg-white px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-300";

export type SalesAiView = {
  baseUrl: string;
  /** 伏せ字。実物は画面に出さない */
  maskedApiKey: string;
  hasKey: boolean;
  tradeMapText: string;
  tradeCount: number;
  checkedAtLabel: string | null;
  checkError: string | null;
};

function Result({ state }: { state: SalesAiState }) {
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

export function SalesAiForm({ view }: { view: SalesAiView }) {
  const [saveState, saveAction, saving] = useActionState(saveSalesAiSettings, EMPTY);
  const [checkState, checkAction, checking] = useActionState(checkSalesAiConnection, EMPTY);
  const [tradesState, tradesAction, loadingTrades] = useActionState(fetchSalesAiTrades, EMPTY_TRADES);

  return (
    <Panel title="営業AI連携（協力会社の開拓）">
      <form action={saveAction} autoComplete="off" className="space-y-2">
        <label className="flex flex-wrap items-center gap-2 text-xs">
          <span className="w-28 shrink-0 font-medium text-slate-700">営業AIのURL</span>
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
          <span className="w-28 shrink-0 font-medium text-slate-700">APIキー</span>
          {/* off はChromeに無視されることが多い。new-password なら保存済みパスワードを入れてこない */}
          <input type="password" name="api_key" required autoComplete="new-password" className={`${input} w-72`} />
          {view.hasKey && <span className="font-mono text-xs text-slate-500">保存済み {view.maskedApiKey}</span>}
        </label>
        <p className="text-xs leading-relaxed text-slate-500">
          営業AIの管理者に発行してもらったテナントのAPIキーです。保存すると画面には伏せ字でしか出ません。
          入れ直すときは、もう一度全部を入力してください。
        </p>

        <label className="block text-xs">
          <span className="font-medium text-slate-700">業種の対応表</span>
          <textarea
            name="trade_map"
            defaultValue={view.tradeMapText}
            rows={6}
            placeholder={"電気 = denki\n清掃 = seisou"}
            className={`${input} mt-1 block w-full font-mono`}
          />
        </label>
        <p className="text-xs leading-relaxed text-slate-500">
          1行に1件、「この製品の業種 = 営業AIの業種コード」の形で書きます。
          営業AI側の業種コードは、下の「業種コードを確認する」で一覧を表示できます。
          <span className="text-amber-700">
            対応表に無い業種では、候補を探せません。
          </span>
          業種を指定せずに問い合わせると、その都道府県の全社が対象になってしまうためです。
        </p>

        <Result state={saveState} />
        <button type="submit" disabled={saving} className={btnClass("primary")}>
          {saving ? "保存中..." : "保存する"}
        </button>
      </form>

      <div className="mt-3 border-t border-slate-100 pt-3">
        <form action={tradesAction}>
          <button type="submit" disabled={loadingTrades} className={btnClass("default", "sm")}>
            {loadingTrades ? "確認中..." : "業種コードを確認する"}
          </button>
        </form>
        {tradesState.error && <p className="mt-1 text-xs leading-relaxed text-rose-700">{tradesState.error}</p>}
        {tradesState.trades && (
          <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-xs text-slate-700 sm:grid-cols-3">
            {tradesState.trades.map((t) => (
              <li key={t.code}>
                {t.label} = {t.code}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs leading-relaxed text-slate-500">
          営業AI側で実際に対応している業種だけが出ます（先に接続情報を保存しておいてください）。
          対応表の右側（＝の右）に、ここに出たコードをそのまま書き写してください。
        </p>
      </div>

      <div className="mt-3 border-t border-slate-100 pt-3">
        <form action={checkAction} className="flex flex-wrap items-center gap-2">
          <button type="submit" disabled={checking} className={btnClass("default", "sm")}>
            {checking ? "確認中..." : "つながるか確認する"}
          </button>
          {view.checkedAtLabel && !view.checkError && (
            <span className="text-xs text-slate-500">最後の確認 {view.checkedAtLabel}（成功）</span>
          )}
          {view.checkedAtLabel && view.checkError && (
            <span className="text-xs text-rose-700">最後の確認 {view.checkedAtLabel}（失敗）</span>
          )}
        </form>
        {/* 失敗の理由を隠さない。設定を直せば解決するものがほとんどなので、そのまま見せる */}
        {view.checkError && <p className="mt-1 text-xs leading-relaxed text-rose-700">{view.checkError}</p>}
        <div className="mt-1">
          <Result state={checkState} />
        </div>
        <p className="mt-2 text-xs leading-relaxed text-slate-500">
          確認では件数を見るだけの問い合わせを1回送ります。リストは作らず、送信もしません。
          <span className="font-medium">この製品から営業のメールやフォーム送信を行うことはありません。</span>
          作ったリストは営業AIの画面で内容を確かめてから、ご自身で送信してください。
        </p>
      </div>
    </Panel>
  );
}
