// 決済（Stripe）の唯一の呼び出し口（CLAUDE.md「外部サービスは packages/*/adapters のみで呼ぶ」）。
// 参照：docs/ClaudeCode_実装指示書.md §4「Stripe Checkout ＋ Webhook 3種＋トライアル30日」
//
// 【価格をコードに書かない】
// 金額はStripeの価格（Price）で持ち、環境変数（STRIPE_PRICE_STD_MONTHLY）でidだけを渡す。
// 価格を決めていなくても実装を進められるし、変えるときもコードを触らない。
//
// 【支払い方法】
// カードと銀行振込（Stripeの customer_balance / jp_bank_transfer）を受け付ける。
// 官公庁まわりの企業はカードを使わないことが多く、振込が無いと契約できない。
// 受け付ける方法は STRIPE_PAYMENT_METHODS で切り替えられる。Stripe側の設定が
// 済んでいない状態で customer_balance を渡すと作成に失敗するため、
// そのときはコードを触らず `card` だけに落とせるようにしてある。
//
// 【Webhookの署名は必ず確かめる】
// この口はログイン不要で誰でも叩ける。署名を確かめずに契約状態を書き換えると、
// 第三者が「支払い済み」を作れてしまう。

import Stripe from "stripe";
import { parsePaymentMethods, stripePaymentMethodTypes, TRIAL_DAYS } from "@ai-nyusatsu-bu/domain";

let client: Stripe | null = null;

function stripe(): Stripe {
  if (client) return client;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY が設定されていません（.envを確認してください）");
  client = new Stripe(key);
  return client;
}

/** 月額プランの価格id。金額はStripe側で決める。 */
export function monthlyPriceId(): string {
  const priceId = process.env.STRIPE_PRICE_STD_MONTHLY;
  if (!priceId) {
    throw new Error(
      "STRIPE_PRICE_STD_MONTHLY が設定されていません。" +
        "Stripeダッシュボードで商品と価格を作り、その価格id（price_ から始まる）を設定してください",
    );
  }
  return priceId;
}

/** Stripeの設定が済んでいるか。済んでいなければ画面で申し込みボタンを出さない。 */
export function isBillingConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_STD_MONTHLY);
}

export type CheckoutInput = {
  /** どの組織の契約か。Webhookで組織を特定するために使う */
  orgId: string;
  orgName: string;
  /** 請求先メールアドレス */
  email: string;
  /** すでにStripeの顧客がいる場合はそのid（二重に顧客を作らない） */
  customerId?: string | null;
  successUrl: string;
  cancelUrl: string;
};

/**
 * 申し込み用のCheckoutを作る。
 *
 * 組織idは metadata と subscription_data.metadata の両方に入れる。
 * checkout.session.completed には session の metadata が、
 * customer.subscription.updated には subscription の metadata が付いてくるため、
 * 片方だけだと後続のイベントで組織が特定できなくなる。
 */
export async function createCheckoutSession(input: CheckoutInput): Promise<{ url: string }> {
  const methods = stripePaymentMethodTypes(parsePaymentMethods(process.env.STRIPE_PAYMENT_METHODS));

  const params: Stripe.Checkout.SessionCreateParams = {
    mode: "subscription",
    line_items: [{ price: monthlyPriceId(), quantity: 1 }],
    payment_method_types: methods as Stripe.Checkout.SessionCreateParams.PaymentMethodType[],
    metadata: { org_id: input.orgId, org_name: input.orgName },
    subscription_data: {
      trial_period_days: TRIAL_DAYS,
      metadata: { org_id: input.orgId, org_name: input.orgName },
    },
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    locale: "ja",
  };

  if (methods.includes("customer_balance")) {
    // 日本の銀行振込（振込先はStripeが発行する）
    params.payment_method_options = {
      customer_balance: {
        bank_transfer: { type: "jp_bank_transfer" },
        funding_type: "bank_transfer",
      },
    };
  }

  // 顧客を作り直すと、過去の請求と振込先がつながらなくなる
  if (input.customerId) params.customer = input.customerId;
  else params.customer_email = input.email;

  const session = await stripe().checkout.sessions.create(params);
  if (!session.url) throw new Error("Checkoutの作成に失敗しました（URLが返りませんでした）");
  return { url: session.url };
}

/** 支払い方法の変更・解約をユーザー自身が行うための画面。 */
export async function createPortalSession(customerId: string, returnUrl: string): Promise<{ url: string }> {
  const session = await stripe().billingPortal.sessions.create({ customer: customerId, return_url: returnUrl });
  return { url: session.url };
}

/**
 * Webhookの署名を確かめて、イベントを取り出す。
 * 署名が合わなければ例外にする（呼び出し側は401を返す）。
 */
export function verifyWebhook(rawBody: string, signature: string | null): Stripe.Event {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET が設定されていません");
  if (!signature) throw new Error("署名ヘッダー（stripe-signature）がありません");
  return stripe().webhooks.constructEvent(rawBody, signature, secret);
}

/** 契約の中身を取りに行く（Checkout完了時は、まだ手元に無いため）。 */
export async function fetchSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
  return stripe().subscriptions.retrieve(subscriptionId);
}

export type { Stripe };
