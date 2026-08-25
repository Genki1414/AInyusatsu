// 協力会社からの返信メールの受信口（タスク4-3）。
// 参照：docs/実装仕様書_v1.md §4.4「返信パース（見積の自動取込）」
//
// 【この口は誰でも叩ける】
// ログイン不要のURLなので、署名を確かめないと第三者が偽の返信を投げ込める。
// 見積金額は応札価格まで流れるため、署名が合わないものは一切保存しない。
// 秘密鍵が設定されていないときも受け付けない（設定漏れのまま口を開けない）。
//
// 【推測で結びつけない】
// 宛先が q.<response_token>@... の形でなければ、どの見積への返信か分からない。
// その場合は quote_id を空のまま保存し、人が見て判断できるようにする。
//
// 【金額は自動で確定させない】
// 抽出できても quotes.amount には書かない。画面で元の文面と並べて見せ、
// 人が「取り込む」を押して初めて反映する（実装仕様書 §4.4）。

import { NextResponse } from "next/server";
import { createServiceClient } from "@ai-nyusatsu-bu/db";
import { parseInboundAddress, parseQuoteReply, verifyWebhookSignature } from "@ai-nyusatsu-bu/domain";

/** 本文をそのまま読む必要があるため、キャッシュも静的化もしない。 */
export const dynamic = "force-dynamic";

type QuoteRow = {
  id: string;
  partner_id: string;
  quote_requests: { org_id: string; tender_id: string } | { org_id: string; tender_id: string }[] | null;
};

function one<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

/** 受け取ったJSONから宛先の一覧を取り出す。providerごとの表記ゆれに耐えるよう幅を持たせる。 */
function recipientAddresses(payload: unknown): string[] {
  const data = (payload as { data?: Record<string, unknown> })?.data ?? {};
  const raw = data.to ?? data.recipient ?? data.recipients;
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : [];
  return list
    .filter((v): v is string => typeof v === "string")
    // "名前 <addr@example.com>" の形でも拾えるようにする
    .map((v) => (v.includes("<") ? (v.split("<")[1] ?? "").replace(">", "") : v).trim())
    .filter((v) => v !== "");
}

/** 本文を取り出す。テキストが無ければHTMLからタグを落として使う。 */
function messageBody(payload: unknown): string {
  const data = (payload as { data?: Record<string, unknown> })?.data ?? {};
  const text = data.text ?? data.plain ?? data.body;
  if (typeof text === "string" && text.trim() !== "") return text;
  const html = data.html;
  if (typeof html === "string") return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return "";
}

export async function POST(request: Request): Promise<NextResponse> {
  const secret = process.env.INBOUND_WEBHOOK_SECRET;
  if (!secret) {
    // 設定漏れのまま口を開けない。届いた内容も保存しない
    console.error("[inbound] INBOUND_WEBHOOK_SECRET が設定されていません。受信を拒否します");
    return NextResponse.json({ error: "not configured" }, { status: 503 });
  }

  // 署名は受け取ったままの本文に対して計算されている。JSONに直して戻すと合わなくなる
  const rawBody = await request.text();
  const check = verifyWebhookSignature(
    secret,
    {
      id: request.headers.get("svix-id"),
      timestamp: request.headers.get("svix-timestamp"),
      signature: request.headers.get("svix-signature"),
    },
    rawBody,
  );
  if (!check.valid) {
    console.error(`[inbound] 署名を確認できませんでした（${check.reason}）`);
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    console.error("[inbound] 本文をJSONとして読めませんでした");
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const messageId = request.headers.get("svix-id");
  const client = createServiceClient();

  // 再送で二重に取り込まない。既に保存済みなら成功として返す（再送を止めるため）
  const { data: existing } = await client
    .from("inbound_messages")
    .select("id")
    .eq("provider_message_id", messageId)
    .maybeSingle<{ id: string }>();
  if (existing) {
    return NextResponse.json({ ok: true, duplicated: true });
  }

  // 宛先から、どの見積への返信かを特定する
  const token = recipientAddresses(payload).map(parseInboundAddress).find((t): t is string => t !== null) ?? null;

  let quote: QuoteRow | null = null;
  if (token) {
    const { data } = await client
      .from("quotes")
      .select("id, partner_id, quote_requests!inner(org_id, tender_id)")
      .eq("response_token", token)
      .maybeSingle<QuoteRow>();
    quote = data ?? null;
  }
  if (!quote) {
    // どの見積か分からない返信も捨てない。人が見て判断できるよう記録は残す
    console.warn(`[inbound] 見積を特定できない返信を受け取りました（宛先のトークン: ${token ?? "なし"}）`);
  }

  const request_ = one(quote?.quote_requests);
  const parsed = parseQuoteReply(messageBody(payload));

  const { error } = await client.from("inbound_messages").insert({
    org_id: request_?.org_id ?? null,
    tender_id: request_?.tender_id ?? null,
    partner_id: quote?.partner_id ?? null,
    quote_id: quote?.id ?? null,
    provider_message_id: messageId,
    channel: "メール",
    body: parsed.text,
    parsed_amount: parsed.amount,
    status: "未取込",
    // 解釈を誤っていても元に戻せるよう、届いた内容をそのまま残す
    raw: payload as Record<string, unknown>,
  });
  if (error) {
    // 保存できなければ再送してもらう（500を返すとSvixが再試行する）
    console.error("[inbound] 受信の保存に失敗しました", error);
    return NextResponse.json({ error: "storage failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, matched: quote !== null, amount: parsed.amount });
}
