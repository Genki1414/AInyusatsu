// 協力会社へ送るメールの「差出人」と「返信先」を決める純ロジック。
//
// 【なぜこの形にするか】
// 協力会社にとっての取引相手は、サービスの運営会社ではなく依頼元の顧客企業。
// 受信箱に運営会社の名前が出たら、誰からの依頼か分からない。
// そのため差出人の表示名は必ず顧客企業の名前にし、返信先も顧客企業に向ける。
//
// 【なぜ実アドレスはサービスのドメインなのか】
// 顧客企業のドメインから実送信するには、そのドメインをResendで認証する必要がある
// （DNSレコードの追加）。これを導入時に求めると顧客が離脱する（ユーザー判断 2026-08-22）。
// SPF・DKIM・DMARCがすべて通るサービスのドメインから送り、表示名と返信先で
// 顧客企業を示す形にする。認証なしで顧客ドメインを騙るとDMARCで弾かれて届かない。
//
// 自社ドメインでの送信を望む顧客には、あとから「自社ドメインを認証する」設定を
// 用意する想定（このファイルの serviceAddress を差し替えれば足りる）。

/** メールアドレスとして最低限の形をしているか。厳密な検証はしない（送信時にResendが弾く）。 */
export function looksLikeEmail(value: string): boolean {
  const trimmed = value.trim();
  return /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(trimmed);
}

/**
 * 表示名に使えない文字を取り除く。
 * 引用符や改行が混ざるとヘッダが壊れ、送信そのものが失敗したり、
 * 別のヘッダを差し込まれる余地になる（メールヘッダインジェクション）。
 */
export function sanitizeDisplayName(name: string): string {
  return name
    .replace(/[\r\n]+/g, " ")
    .replace(/["\\<>]/g, "")
    .trim()
    .slice(0, 100);
}

/**
 * Fromヘッダを組み立てる。表示名は依頼元の顧客企業、実アドレスはサービスのもの。
 * 表示名が空になる場合は、アドレスだけを返す（`<addr>` だけの不自然な形にしない）。
 */
export function buildFromHeader(orgName: string, serviceAddress: string): string {
  const display = sanitizeDisplayName(orgName);
  return display === "" ? serviceAddress : `${display} <${serviceAddress}>`;
}

/**
 * 返信先を決める。
 * 顧客が明示的に設定していればそれを使い、無ければ登録者（owner）のアドレスに落とす。
 * どちらも無ければ null（Reply-Toを付けない）。
 *
 * 返信先を空にしたままにすると、協力会社の返信がサービスのアドレスへ飛び、
 * 顧客が気づかないまま商談が止まる。そのため必ずどこかへ向ける。
 */
export function resolveReplyTo(configured: string | null, fallback: string | null): string | null {
  const candidate = configured?.trim() || fallback?.trim() || "";
  if (candidate === "" || !looksLikeEmail(candidate)) return null;
  return candidate;
}

export type SenderIdentity = { from: string; replyTo: string | null };

/** 差出人と返信先をまとめて決める。 */
export function resolveSenderIdentity(input: {
  orgName: string;
  serviceAddress: string;
  configuredReplyTo: string | null;
  ownerEmail: string | null;
}): SenderIdentity {
  return {
    from: buildFromHeader(input.orgName, input.serviceAddress),
    replyTo: resolveReplyTo(input.configuredReplyTo, input.ownerEmail),
  };
}
