// ご契約の画面。表示だけで、操作は無い。
//
// 支払いは請求書払いのみ（ユーザー決定 2026-08-25）。
// 申し込み・支払い方法の変更・解約は、運営が受け付けて手で行う。
// 画面にボタンを置くと「自分で変えられる」と誤解させる。

import { Panel, Pill } from "@/components/ui";
import { PAYMENT_METHOD_LABEL } from "@ai-nyusatsu-bu/domain";

export type BillingView = {
  active: boolean;
  statusMessage: string;
  startedOn: string | null;
  supportEmail: string | null;
};

export function BillingForm({ view }: { view: BillingView }) {
  return (
    <>
      <Panel title="ご契約">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone={view.active ? "green" : "rose"}>{view.active ? "利用中" : "停止"}</Pill>
            <span className="text-xs text-slate-500">お支払い方法：{PAYMENT_METHOD_LABEL}</span>
          </div>

          <p className="text-xs leading-relaxed text-slate-700">{view.statusMessage}</p>

          {view.startedOn && <p className="text-xs text-slate-500">ご利用開始日：{view.startedOn}</p>}
        </div>
      </Panel>

      <Panel title="お支払いについて">
        <ul className="space-y-1.5 text-xs leading-relaxed text-slate-700">
          <li>・お支払いは請求書払い（銀行振込）のみです。クレジットカードは承っておりません。</li>
          <li>・ご請求書は運営からお送りします。振込先は請求書に記載しています。</li>
          <li>・ご利用の開始・停止、お支払いに関するご相談は、担当者までご連絡ください。</li>
          <li>・アカウントの発行も運営が行います。追加をご希望の場合はお申し付けください。</li>
        </ul>
        {view.supportEmail && (
          <p className="mt-2 text-xs text-slate-600">
            お問い合わせ：
            <a href={`mailto:${view.supportEmail}`} className="underline">
              {view.supportEmail}
            </a>
          </p>
        )}
      </Panel>
    </>
  );
}
