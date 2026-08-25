// 契約状態の判定（タスク4-7 課金）。
// 参照：docs/ClaudeCode_実装指示書.md §4「Stripe Checkout ＋ Webhook 3種＋トライアル30日」
//       同 §5「Stripe Webhook は stripe_event_id で冪等に。同じイベントが複数回来ます」
//
// 【なぜ純ロジックに切り出すか】
// Stripeの状態名（trialing / active / past_due …）をそのまま画面やDBに出すと、
// 決済事業者を差し替えたときに全部を書き直すことになる。
// ここで自分たちの言葉に直し、画面・DB・判定はこちらの言葉だけを見る。
//
// 【止め方は慎重に】
// 支払いが遅れているからといって即座に使えなくすると、入札の締切直前に締め出す事故が起きる。
// 支払い遅延は「使えるが警告を出す」状態にし、解約されたときだけ止める。
//
// 【価格はここで決めない】
// 金額はStripe側の価格（Price）で持ち、コードには入れない。
// 価格を後から変えても、このファイルは触らなくてよいようにする。

/** トライアル期間（日）。 */
export const TRIAL_DAYS = 30;

export const SUBSCRIPTION_STATUSES = ["未契約", "トライアル中", "有効", "支払い遅延", "解約済"] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export type PaymentMethodKind = "カード" | "銀行振込";

/**
 * Stripeの状態を自分たちの言葉に直す。
 * 知らない状態が来たら「未契約」にはせず、そのまま使えない側へ倒さない
 * （Stripeが新しい状態を増やしたときに、黙って全社を止めないため）。
 */
export function mapStripeStatus(stripeStatus: string): SubscriptionStatus {
  switch (stripeStatus) {
    case "trialing":
      return "トライアル中";
    case "active":
      return "有効";
    case "past_due":
    case "unpaid":
      return "支払い遅延";
    case "canceled":
    case "incomplete_expired":
      return "解約済";
    case "incomplete":
    case "paused":
      return "未契約";
    default:
      // 知らない状態。止めるのではなく、人が気づけるように支払い遅延として扱う
      return "支払い遅延";
  }
}

/**
 * サービスを使える状態か。
 *
 * 支払い遅延でも使える。締切直前に締め出すほうが損害が大きいため、
 * 画面で警告を出し、止めるかどうかは人が決める。
 */
export function isUsable(status: SubscriptionStatus): boolean {
  return status === "トライアル中" || status === "有効" || status === "支払い遅延";
}

/** 画面に出す一言。状態ごとに「次にやること」が分かるようにする。 */
export function statusMessage(status: SubscriptionStatus, options: { trialEndsAt?: string | null } = {}): string {
  switch (status) {
    case "未契約": {
      return `お試し期間は${TRIAL_DAYS}日間です。期間中に解約すれば費用はかかりません。`;
    }
    case "トライアル中": {
      const until = options.trialEndsAt ? formatJstDay(options.trialEndsAt) : null;
      return until === null
        ? "お試し期間中です。"
        : `お試し期間中です（${until}まで）。期間が終わると自動で課金が始まります。`;
    }
    case "有効":
      return "ご利用中です。";
    case "支払い遅延":
      return "お支払いが確認できていません。お支払い方法をご確認ください。ご利用は続けられます。";
    case "解約済":
      return "解約済みです。もう一度お申し込みいただけます。";
  }
}

/** 「2026年9月24日」の形。読めなければ null。 */
export function formatJstDay(at: string): string | null {
  const parsed = new Date(at);
  if (Number.isNaN(parsed.getTime())) return null;
  const jst = new Date(parsed.getTime() + 9 * 60 * 60 * 1000);
  return `${jst.getUTCFullYear()}年${jst.getUTCMonth() + 1}月${jst.getUTCDate()}日`;
}

/**
 * 支払い方法をStripeの値に直す。
 * Checkoutに渡す値なので、知らない指定はカードに落とす（決済ができない状態にしない）。
 */
export function stripePaymentMethodTypes(kinds: PaymentMethodKind[]): string[] {
  const types = new Set<string>();
  for (const kind of kinds) {
    if (kind === "銀行振込") types.add("customer_balance");
    else types.add("card");
  }
  if (types.size === 0) types.add("card");
  return [...types];
}

/** 環境変数から受け付ける支払い方法を読む。未設定ならカードと銀行振込の両方。 */
export function parsePaymentMethods(raw: string | undefined): PaymentMethodKind[] {
  const value = raw?.trim();
  if (!value) return ["カード", "銀行振込"];

  const kinds: PaymentMethodKind[] = [];
  for (const entry of value.split(",")) {
    const name = entry.trim().toLowerCase();
    if (name === "card" || name === "カード") kinds.push("カード");
    else if (name === "customer_balance" || name === "bank_transfer" || name === "銀行振込") kinds.push("銀行振込");
  }
  // 打ち間違いで決済ができなくならないよう、1つも読めなければカードに落とす
  return kinds.length > 0 ? [...new Set(kinds)] : ["カード"];
}

/** Stripeの支払い方法を、画面に出す言葉に直す。 */
export function paymentMethodLabel(stripeType: string | null): PaymentMethodKind | null {
  if (stripeType === null) return null;
  if (stripeType === "customer_balance" || stripeType === "bank_transfer") return "銀行振込";
  if (stripeType === "card") return "カード";
  return null;
}

/** 受け取るWebhookの種類。これ以外は記録だけして何もしない。 */
export const HANDLED_STRIPE_EVENTS = [
  "checkout.session.completed",
  "customer.subscription.updated",
  "customer.subscription.deleted",
] as const;

export type HandledStripeEvent = (typeof HANDLED_STRIPE_EVENTS)[number];

export function isHandledStripeEvent(type: string): type is HandledStripeEvent {
  return (HANDLED_STRIPE_EVENTS as readonly string[]).includes(type);
}
