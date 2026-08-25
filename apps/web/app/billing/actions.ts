"use server";

// 申し込みと、支払い方法の変更・解約（タスク4-7）。
//
// 【状態はここで書き換えない】
// 契約状態（subscriptions）を書くのはStripeのWebhookだけ。画面から書けると、
// 支払っていないのに「有効」にできてしまう。ここは Stripe の画面へ送るだけ。
//
// 【顧客を作り直さない】
// すでにStripeの顧客idがあるなら、それを渡す。作り直すと過去の請求と
// 振込先がつながらなくなり、銀行振込の入金が宙に浮く。

import { redirect } from "next/navigation";
import { createCheckoutSession, createPortalSession, isBillingConfigured } from "@ai-nyusatsu-bu/billing";
import { requireOrgContext } from "@/lib/auth";

export type BillingActionState = { error: string | null };

function appUrl(): string {
  return (process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3001").replace(/\/+$/, "");
}

/** 申し込む。Stripeの支払い画面へ送る。 */
export async function startCheckout(_prev: BillingActionState, _formData: FormData): Promise<BillingActionState> {
  if (!isBillingConfigured()) {
    return { error: "決済の設定が済んでいません。運営にお問い合わせください。" };
  }

  const { supabase, orgId, orgName, userEmail } = await requireOrgContext();

  const { data: current } = await supabase
    .from("subscriptions")
    .select("stripe_customer_id")
    .eq("org_id", orgId)
    .maybeSingle<{ stripe_customer_id: string | null }>();

  let url: string;
  try {
    const session = await createCheckoutSession({
      orgId,
      orgName,
      email: userEmail,
      customerId: current?.stripe_customer_id ?? null,
      successUrl: `${appUrl()}/billing?done=1`,
      cancelUrl: `${appUrl()}/billing`,
    });
    url = session.url;
  } catch (err) {
    // 何が起きたかを運営が追えるように残す。画面には内部の詳細を出さない
    console.error(`[billing] Checkoutを作れませんでした（org=${orgId}）`, err);
    return { error: "お申し込み画面を開けませんでした。時間をおいて試すか、運営にお問い合わせください。" };
  }

  redirect(url);
}

/** 支払い方法の変更・解約。Stripeの管理画面へ送る。 */
export async function openPortal(_prev: BillingActionState, _formData: FormData): Promise<BillingActionState> {
  const { supabase, orgId } = await requireOrgContext();

  const { data: current } = await supabase
    .from("subscriptions")
    .select("stripe_customer_id")
    .eq("org_id", orgId)
    .maybeSingle<{ stripe_customer_id: string | null }>();

  if (!current?.stripe_customer_id) {
    return { error: "まだお申し込みがありません。" };
  }

  let url: string;
  try {
    const session = await createPortalSession(current.stripe_customer_id, `${appUrl()}/billing`);
    url = session.url;
  } catch (err) {
    console.error(`[billing] 管理画面を開けませんでした（org=${orgId}）`, err);
    return { error: "お支払い情報の画面を開けませんでした。時間をおいて試してください。" };
  }

  redirect(url);
}
