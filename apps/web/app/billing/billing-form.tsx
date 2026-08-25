"use client";

// 契約の画面（タスク4-7）。
// 申し込み・支払い方法の変更・解約はすべてStripeの画面で行う。
// ここでは「いまどうなっているか」と「次にやること」だけを出す。

import { useActionState } from "react";
import { Panel, Pill, btnClass } from "@/components/ui";
import { openPortal, startCheckout, type BillingActionState } from "./actions";

const initialState: BillingActionState = { error: null };

export type BillingView = {
  status: string;
  statusMessage: string;
  usable: boolean;
  paymentMethod: string | null;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  hasCustomer: boolean;
  configured: boolean;
};

function tone(status: string): "green" | "blue" | "amber" | "slate" {
  if (status === "有効") return "green";
  if (status === "トライアル中") return "blue";
  if (status === "支払い遅延") return "amber";
  return "slate";
}

export function BillingForm({ view }: { view: BillingView }) {
  const [checkoutState, checkoutAction, checkoutPending] = useActionState(startCheckout, initialState);
  const [portalState, portalAction, portalPending] = useActionState(openPortal, initialState);

  return (
    <>
      <Panel title="ご契約">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone={tone(view.status)}>{view.status}</Pill>
            {view.paymentMethod && <span className="text-xs text-slate-500">お支払い方法：{view.paymentMethod}</span>}
          </div>

          <p className="text-xs leading-relaxed text-slate-700">{view.statusMessage}</p>

          {view.cancelAtPeriodEnd && view.currentPeriodEnd && (
            <p className="text-xs text-amber-700">
              {view.currentPeriodEnd}でご利用が終わります。それまでは今までどおりお使いいただけます。
            </p>
          )}

          {!view.cancelAtPeriodEnd && view.currentPeriodEnd && view.status === "有効" && (
            <p className="text-xs text-slate-500">次回のお支払い：{view.currentPeriodEnd}</p>
          )}

          <div className="flex flex-wrap gap-2">
            {!view.usable && view.configured && (
              <form action={checkoutAction}>
                <button type="submit" disabled={checkoutPending} className={btnClass("primary")}>
                  {checkoutPending ? "画面を開いています…" : "お申し込みへ進む"}
                </button>
              </form>
            )}
            {view.hasCustomer && (
              <form action={portalAction}>
                <button type="submit" disabled={portalPending} className={btnClass()}>
                  {portalPending ? "画面を開いています…" : "お支払い情報・解約"}
                </button>
              </form>
            )}
          </div>

          {!view.configured && (
            <p role="alert" className="text-xs text-slate-500">
              現在お申し込みを受け付けていません。運営にお問い合わせください。
            </p>
          )}
          {checkoutState.error && (
            <p role="alert" className="text-xs text-rose-700">
              {checkoutState.error}
            </p>
          )}
          {portalState.error && (
            <p role="alert" className="text-xs text-rose-700">
              {portalState.error}
            </p>
          )}
        </div>
      </Panel>

      <Panel title="お支払いについて">
        <ul className="space-y-1.5 text-xs leading-relaxed text-slate-700">
          <li>・クレジットカードと銀行振込をお選びいただけます。お申し込みの画面で選択してください。</li>
          <li>・銀行振込の場合、振込先はお申し込み後にご案内します。入金の確認までに数日かかります。</li>
          <li>・お試し期間中に解約された場合、費用はかかりません。</li>
          <li>・領収書と請求書はお支払い情報の画面からご確認いただけます。</li>
        </ul>
      </Panel>
    </>
  );
}
