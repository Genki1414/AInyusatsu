import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyWebhookSignature, type SignatureCheck } from "./webhook_signature";

/** 判定結果から理由を取り出す（成功なら null）。 */
function reasonOf(check: SignatureCheck): string | null {
  return check.valid ? null : check.reason;
}

const SECRET = `whsec_${Buffer.from("test-signing-key").toString("base64")}`;
const NOW = new Date("2026-08-25T15:00:00Z");
const ID = "msg_2abc";
const TIMESTAMP = String(Math.floor(NOW.getTime() / 1000));
const BODY = '{"type":"email.received","data":{"subject":"RE: 見積依頼"}}';

function sign(id: string, timestamp: string, body: string, secret = SECRET): string {
  const key = Buffer.from(secret.slice("whsec_".length), "base64");
  return `v1,${createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64")}`;
}

const headers = (over: Partial<{ id: string; timestamp: string; signature: string }> = {}) => ({
  id: ID,
  timestamp: TIMESTAMP,
  signature: sign(ID, TIMESTAMP, BODY),
  ...over,
});

describe("verifyWebhookSignature", () => {
  it("正しい署名を受け入れる", () => {
    expect(verifyWebhookSignature(SECRET, headers(), BODY, NOW)).toEqual({ valid: true });
  });

  it("鍵の入れ替え中のように署名が複数並んでいても、どれか合えば受け入れる", () => {
    const signature = `v1,ZmFrZQ== ${sign(ID, TIMESTAMP, BODY)}`;
    expect(verifyWebhookSignature(SECRET, headers({ signature }), BODY, NOW).valid).toBe(true);
  });

  it("本文が書き換えられていたら弾く", () => {
    const tampered = '{"type":"email.received","data":{"subject":"改ざん"}}';
    expect(verifyWebhookSignature(SECRET, headers(), tampered, NOW)).toEqual({ valid: false, reason: "mismatch" });
  });

  it("別の鍵で署名されていたら弾く", () => {
    const other = `whsec_${Buffer.from("another-key").toString("base64")}`;
    const signature = sign(ID, TIMESTAMP, BODY, other);
    expect(reasonOf(verifyWebhookSignature(SECRET, headers({ signature }), BODY, NOW))).toBe("mismatch");
  });

  it("IDが違えば弾く（署名対象に含まれるため）", () => {
    expect(reasonOf(verifyWebhookSignature(SECRET, headers({ id: "msg_other" }), BODY, NOW))).toBe("mismatch");
  });

  it("古い署名は弾く（使い回しを防ぐ）", () => {
    const old = String(Math.floor(NOW.getTime() / 1000) - 6 * 60);
    const signature = sign(ID, old, BODY);
    expect(reasonOf(verifyWebhookSignature(SECRET, headers({ timestamp: old, signature }), BODY, NOW))).toBe("expired");
  });

  it("許容時間の内なら受け入れる", () => {
    const recent = String(Math.floor(NOW.getTime() / 1000) - 4 * 60);
    const signature = sign(ID, recent, BODY);
    expect(verifyWebhookSignature(SECRET, headers({ timestamp: recent, signature }), BODY, NOW).valid).toBe(true);
  });

  it("ヘッダーが欠けていれば弾く", () => {
    for (const missing of [{ id: null }, { timestamp: null }, { signature: null }] as const) {
      const h = { ...headers(), ...missing };
      expect(reasonOf(verifyWebhookSignature(SECRET, h, BODY, NOW)), JSON.stringify(missing)).toBe("missing_header");
    }
  });

  it("時刻が数値でなければ弾く", () => {
    expect(reasonOf(verifyWebhookSignature(SECRET, headers({ timestamp: "いま" }), BODY, NOW))).toBe("bad_timestamp");
  });

  it("秘密鍵が空なら弾く（設定漏れを通さない）", () => {
    expect(reasonOf(verifyWebhookSignature("whsec_", headers(), BODY, NOW))).toBe("bad_secret");
    expect(reasonOf(verifyWebhookSignature("", headers(), BODY, NOW))).toBe("bad_secret");
  });
});
