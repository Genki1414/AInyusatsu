// ご契約（タスク4-7）。
//
// 契約状態はStripeのWebhookが書いた subscriptions を読むだけ。
// 画面から書き換えられると、支払っていないのに「有効」にできてしまう。

import { isBillingConfigured } from "@ai-nyusatsu-bu/billing";
import { formatJstDay, isUsable, statusMessage, type SubscriptionStatus } from "@ai-nyusatsu-bu/domain";
import { AppShell } from "@/components/AppShell";
import { requireOrgContext } from "@/lib/auth";
import { BillingForm, type BillingView } from "./billing-form";

type SubscriptionRow = {
  stripe_customer_id: string | null;
  status: string;
  payment_method: string | null;
  trial_ends_at: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
};

export default async function BillingPage() {
  const { supabase, orgId, orgName } = await requireOrgContext();

  const { data, error } = await supabase
    .from("subscriptions")
    .select("stripe_customer_id, status, payment_method, trial_ends_at, current_period_end, cancel_at_period_end")
    .eq("org_id", orgId)
    .maybeSingle<SubscriptionRow>();
  if (error) {
    // 契約が読めなくても画面は出す（未契約として扱う）。握りつぶさずログには残す
    console.error(`[billing] 契約の取得に失敗しました（org=${orgId}）: ${error.message}`);
  }

  const status = (data?.status ?? "未契約") as SubscriptionStatus;
  const view: BillingView = {
    status,
    statusMessage: statusMessage(status, { trialEndsAt: data?.trial_ends_at ?? null }),
    usable: isUsable(status),
    paymentMethod: data?.payment_method ?? null,
    trialEndsAt: data?.trial_ends_at ? formatJstDay(data.trial_ends_at) : null,
    currentPeriodEnd: data?.current_period_end ? formatJstDay(data.current_period_end) : null,
    cancelAtPeriodEnd: data?.cancel_at_period_end ?? false,
    hasCustomer: Boolean(data?.stripe_customer_id),
    configured: isBillingConfigured(),
  };

  return (
    <AppShell active="billing" orgName={orgName}>
      <BillingForm view={view} />
    </AppShell>
  );
}
