// Stripeからの通知を受け取る口（タスク4-7）。
// 参照：docs/ClaudeCode_実装指示書.md §5「Stripe Webhook は stripe_event_id で冪等に。
//       同じイベントが複数回来ます」
//
// 【この口は誰でも叩ける】
// ログイン不要のURLなので、署名を確かめないと第三者が「支払い済み」を作れてしまう。
// 署名が合わないものは一切処理しない。秘密鍵が未設定なら口を開けない。
//
// 【同じイベントが何度も来る】
// Stripeは配信を再試行する。stripe_events に記録してから処理し、
// 記録に失敗した（＝すでに処理済みの）イベントは何もせず成功で返す。
//
// 【状態はStripeを正とする】
// 契約状態は画面から書き換えない。ここ（service_role）だけが書く。
// 画面から書けると、支払っていないのに「有効」にできてしまう。

import { NextResponse } from "next/server";
import { createServiceClient } from "@ai-nyusatsu-bu/db";
import { fetchSubscription, verifyWebhook, type Stripe } from "@ai-nyusatsu-bu/billing";
import { isHandledStripeEvent, mapStripeStatus, paymentMethodLabel } from "@ai-nyusatsu-bu/domain";

/** 署名は受け取ったままの本文に対して計算されている。JSONに直して戻すと合わなくなる。 */
export const dynamic = "force-dynamic";

/** Postgres の一意制約違反。すでに処理したイベント。 */
const UNIQUE_VIOLATION = "23505";

export async function POST(request: Request): Promise<NextResponse> {
  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    // 設定漏れのまま口を開けない
    console.error("[stripe] STRIPE_WEBHOOK_SECRET が設定されていません。受信を拒否します");
    return NextResponse.json({ error: "not configured" }, { status: 503 });
  }

  const rawBody = await request.text();

  let event: Stripe.Event;
  try {
    event = verifyWebhook(rawBody, request.headers.get("stripe-signature"));
  } catch (err) {
    console.error("[stripe] 署名を確認できませんでした", err);
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  const client = createServiceClient();

  // 処理する前に記録を確保する。二重に届いても2回は処理しない
  const { error: claimError } = await client.from("stripe_events").insert({ id: event.id, type: event.type });
  if (claimError) {
    if (claimError.code === UNIQUE_VIOLATION) {
      return NextResponse.json({ ok: true, duplicated: true });
    }
    // 記録できないと二重処理を防げない。再送してもらう
    console.error("[stripe] イベントの記録に失敗しました", claimError);
    return NextResponse.json({ error: "storage failed" }, { status: 500 });
  }

  if (!isHandledStripeEvent(event.type)) {
    // 受け取るが何もしない。何が来ているかは記録に残る
    return NextResponse.json({ ok: true, ignored: event.type });
  }

  try {
    await handle(client, event);
  } catch (err) {
    // 処理できなかったイベントは、記録を消して再送で拾い直せるようにする。
    // 記録だけ残ると、その契約はずっと古い状態のままになる
    await client.from("stripe_events").delete().eq("id", event.id);
    console.error(`[stripe] イベントの処理に失敗しました（${event.type} ${event.id}）`, err);
    return NextResponse.json({ error: "handler failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, type: event.type });
}

type Client = ReturnType<typeof createServiceClient>;

async function handle(client: Client, event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const orgId = session.metadata?.org_id ?? null;
      if (!orgId) {
        // 組織が分からない契約は結びつけない（推測で他社の契約にしない）
        console.error(`[stripe] Checkoutに組織idがありません（session=${session.id}）`);
        return;
      }
      const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
      if (!subscriptionId) {
        console.error(`[stripe] Checkoutに契約idがありません（session=${session.id}）`);
        return;
      }

      // Checkout完了の時点では契約の中身が入っていないので、取りに行く
      const subscription = await fetchSubscription(subscriptionId);
      await save(client, orgId, subscription, {
        customerId: typeof session.customer === "string" ? session.customer : (session.customer?.id ?? null),
        paymentMethod: session.payment_method_types?.[0] ?? null,
      });
      return;
    }

    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      const orgId = subscription.metadata?.org_id ?? null;
      if (!orgId) {
        console.error(`[stripe] 契約に組織idがありません（subscription=${subscription.id}）`);
        return;
      }
      await save(client, orgId, subscription, {
        customerId: typeof subscription.customer === "string" ? subscription.customer : (subscription.customer?.id ?? null),
        paymentMethod: subscription.payment_settings?.payment_method_types?.[0] ?? null,
      });
      return;
    }
  }
}

/**
 * 契約の状態を保存する。
 * 解約されても行は消さない。いつ解約したか、また申し込めるかを画面で示すため。
 */
async function save(
  client: Client,
  orgId: string,
  subscription: Stripe.Subscription,
  extra: { customerId: string | null; paymentMethod: string | null },
): Promise<void> {
  const row: Record<string, unknown> = {
    org_id: orgId,
    stripe_subscription_id: subscription.id,
    status: mapStripeStatus(subscription.status),
    trial_ends_at: toIso(subscription.trial_end),
    current_period_end: toIso(currentPeriodEnd(subscription)),
    cancel_at_period_end: subscription.cancel_at_period_end === true,
    updated_at: new Date().toISOString(),
  };
  if (extra.customerId) row.stripe_customer_id = extra.customerId;

  const label = paymentMethodLabel(extra.paymentMethod);
  // 読めない支払い方法で、いま入っている値を消さない
  if (label !== null) row.payment_method = label;

  const { error } = await client.from("subscriptions").upsert(row, { onConflict: "org_id" });
  if (error) throw new Error(`契約の保存に失敗しました: ${error.message}`);
}

function toIso(seconds: number | null | undefined): string | null {
  if (typeof seconds !== "number") return null;
  return new Date(seconds * 1000).toISOString();
}

/**
 * 今の請求期間の終わり。
 * Stripeは版によって subscription 直下と items 側の両方に持つため、取れるほうを使う。
 */
function currentPeriodEnd(subscription: Stripe.Subscription): number | null {
  const direct = (subscription as unknown as { current_period_end?: number }).current_period_end;
  if (typeof direct === "number") return direct;
  const item = subscription.items?.data?.[0] as unknown as { current_period_end?: number } | undefined;
  return typeof item?.current_period_end === "number" ? item.current_period_end : null;
}
