// Webhookの署名検証（タスク4-3の受信口）。
//
// 【なぜ必須か】
// 受信口はログイン不要で誰でもPOSTできるURLになる。署名を確かめないと、
// 第三者が偽の返信を投げ込んで見積金額を差し込める。金額は応札価格まで流れるため、
// ここは必ず塞ぐ。
//
// Resendのwebhookは Svix の方式で署名される。仕様は公開されていて、
//   署名対象 = `${svix-id}.${svix-timestamp}.${本文}`
//   鍵       = 秘密鍵の "whsec_" を除いた部分をbase64デコードしたもの
//   署名     = HMAC-SHA256 をbase64にしたもの
//   ヘッダ   = "v1,<署名> v1,<署名>" のように空白区切りで複数入ることがある（鍵の入れ替え中）
// となっている。

import { createHmac, timingSafeEqual } from "node:crypto";

/** 署名の許容時間（秒）。古い署名の使い回し（リプレイ）を防ぐ。 */
export const SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

export type WebhookHeaders = {
  id: string | null;
  timestamp: string | null;
  signature: string | null;
};

export type SignatureCheck =
  | { valid: true }
  /** 検証できなかった理由。ログに残すために持つ（握りつぶさない） */
  | { valid: false; reason: "missing_header" | "bad_timestamp" | "expired" | "mismatch" | "bad_secret" };

/**
 * 署名を確かめる。
 * 本文は受け取ったままの文字列を渡すこと（JSONに直して戻すと空白が変わり、署名が合わなくなる）。
 */
export function verifyWebhookSignature(
  secret: string,
  headers: WebhookHeaders,
  rawBody: string,
  now: Date = new Date(),
): SignatureCheck {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) return { valid: false, reason: "missing_header" };

  const sentAt = Number(timestamp);
  if (!Number.isFinite(sentAt)) return { valid: false, reason: "bad_timestamp" };
  const ageSeconds = Math.abs(Math.floor(now.getTime() / 1000) - sentAt);
  if (ageSeconds > SIGNATURE_TOLERANCE_SECONDS) return { valid: false, reason: "expired" };

  const key = secretToKey(secret);
  if (key === null) return { valid: false, reason: "bad_secret" };

  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${rawBody}`).digest("base64");

  // 鍵の入れ替え中は複数の署名が並ぶ。どれか1つが合えばよい
  const sent = signature.split(" ").map((part) => part.split(",")[1] ?? "");
  const matched = sent.some((candidate) => safeEquals(candidate, expected));
  return matched ? { valid: true } : { valid: false, reason: "mismatch" };
}

/** 秘密鍵（whsec_...）を鍵のバイト列に直す。 */
function secretToKey(secret: string): Buffer | null {
  const body = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret;
  if (body === "") return null;
  const key = Buffer.from(body, "base64");
  return key.length > 0 ? key : null;
}

/** 長さの違いで内容を推測されないよう、時間の一定な比較を使う。 */
function safeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
