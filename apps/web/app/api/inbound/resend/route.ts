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
//
// 【返信が来たことは記録する】
// これまで quotes.replied_at を立てるのは「担当者が金額を手入力したとき」と
// 「協力会社が回答ページを操作したとき」だけだった。メールで見積書を送り返してきた
// 協力会社は未回答のままで、回答期限の24時間前に催促が飛んでいた。
// 返信が届いた事実だけは確実なので、ここで記録して催促を止める。
//
// 【項目名を決め打ちしない】
// 最初の1通は記録できたのに本文が空・添付ゼロだった（2026-08-25）。data.text / data.attachments と
// 決め打ちしていたためで、中身は raw に残っていた。今はJSON全体をたどって探す（findMessageBody / findAttachments）。
// それでも見つからなかったときは、どこも該当しなかったことをログに残す（黙って空で保存しない）。
//
// 【見送りは自動で確定させない】
// 本文から辞退を読み取れても quotes.declined は変えない。読み違えると原価集計から
// 外れてしまう。人が画面で見て判断する。

import { NextResponse } from "next/server";
import { createServiceClient } from "@ai-nyusatsu-bu/db";
import {
  attachmentStorageKey,
  extractAttachments,
  findAttachments,
  findMessageBody,
  findRecipients,
  MAX_ATTACHMENT_BYTES,
  parseInboundAddress,
  parseQuoteReply,
  verifyWebhookSignature,
  type InboundAttachment,
} from "@ai-nyusatsu-bu/domain";

/** 本文をそのまま読む必要があるため、キャッシュも静的化もしない。 */
export const dynamic = "force-dynamic";

/**
 * 見積書の保存先。本部が取得した資料（tender-documents）とは分ける。
 * あちらは顧客企業に配らない方針、こちらは顧客企業自身の商談の書類で見せてよいもの。
 * 同じ入れ物に混ぜると、取り違えたときに配ってはいけない資料が出てしまう。
 */
const ATTACHMENT_BUCKET = process.env.QUOTE_ATTACHMENTS_BUCKET || "quote-attachments";

type StoredAttachment = { filename: string; storageKey: string; contentType: string | null; bytes: number };

type QuoteRow = {
  id: string;
  partner_id: string;
  quote_requests: { org_id: string; tender_id: string } | { org_id: string; tender_id: string }[] | null;
};

function one<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
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
  const token = findRecipients(payload).map(parseInboundAddress).find((t): t is string => t !== null) ?? null;

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

  const body = findMessageBody(payload);
  const attachmentsHit = findAttachments(payload);
  // 読めなかったときに「なぜ空なのか」が後から分かるようにする
  if (body.text === "") console.warn(`[inbound] 本文を見つけられませんでした（${messageId ?? "id不明"}）`);
  if (attachmentsHit.path === null) console.info(`[inbound] 添付の項目が見当たりません（${messageId ?? "id不明"}）`);

  const parsed = parseQuoteReply(body.text);
  const stored = await storeAttachments(client, extractAttachments(payload), {
    quoteId: quote?.id ?? null,
    messageId: messageId ?? "unknown",
  });

  const { error } = await client.from("inbound_messages").insert({
    org_id: request_?.org_id ?? null,
    tender_id: request_?.tender_id ?? null,
    partner_id: quote?.partner_id ?? null,
    quote_id: quote?.id ?? null,
    provider_message_id: messageId,
    channel: "メール",
    body: parsed.text,
    parsed_amount: parsed.amount,
    attachments: stored,
    status: "未取込",
    // 解釈を誤っていても元に戻せるよう、届いた内容をそのまま残す
    raw: payload as Record<string, unknown>,
  });
  if (error) {
    // 保存できなければ再送してもらう（500を返すとSvixが再試行する）
    console.error("[inbound] 受信の保存に失敗しました", error);
    return NextResponse.json({ error: "storage failed" }, { status: 500 });
  }

  // 返信が届いた事実を記録して催促を止める。金額と見送りは人の確認に委ねる
  if (quote) {
    const { error: repliedError } = await client
      .from("quotes")
      .update({ replied_at: new Date().toISOString() })
      .eq("id", quote.id)
      .is("replied_at", null);
    if (repliedError) {
      // 記録に失敗しても受信そのものは成功している。再送させると二重に保存されるため成功を返す
      console.error(`[inbound] 返信日時の記録に失敗しました（quote=${quote.id}）`, repliedError);
    }
  }

  return NextResponse.json({
    ok: true,
    matched: quote !== null,
    amount: parsed.amount,
    attachments: stored.length,
  });
}

/**
 * 添付をStorageへ保存する。
 *
 * 1件でも失敗したら他を諦める、ということはしない（見積書が1つでも残るほうがよい）。
 * 保存できなかったものはログに残す（握りつぶさない）。
 */
async function storeAttachments(
  client: ReturnType<typeof createServiceClient>,
  attachments: InboundAttachment[],
  scope: { quoteId: string | null; messageId: string },
): Promise<StoredAttachment[]> {
  const stored: StoredAttachment[] = [];

  for (const [index, attachment] of attachments.entries()) {
    try {
      const bytes = await attachmentBytes(attachment);
      if (bytes === null) continue;
      if (bytes.byteLength > MAX_ATTACHMENT_BYTES) {
        console.warn(`[inbound] 添付が大きすぎるため保存しませんでした（${attachment.filename} / ${bytes.byteLength}バイト）`);
        continue;
      }

      const storageKey = attachmentStorageKey(scope, index, attachment.filename);
      const { error } = await client.storage.from(ATTACHMENT_BUCKET).upload(storageKey, bytes, {
        contentType: attachment.contentType ?? "application/octet-stream",
        upsert: true,
      });
      if (error) throw new Error(error.message);

      stored.push({
        filename: attachment.filename,
        storageKey,
        contentType: attachment.contentType,
        bytes: bytes.byteLength,
      });
    } catch (err) {
      console.error(`[inbound] 添付の保存に失敗しました（${attachment.filename}）`, err);
    }
  }

  return stored;
}

/** 添付の中身を取り出す。base64で入っていればそれを、URLなら取りに行く。 */
async function attachmentBytes(attachment: InboundAttachment): Promise<Buffer | null> {
  if (attachment.base64 !== null) {
    return Buffer.from(attachment.base64, "base64");
  }
  if (attachment.url !== null) {
    const response = await fetch(attachment.url);
    if (!response.ok) throw new Error(`取得に失敗しました（HTTP ${response.status}）`);
    return Buffer.from(await response.arrayBuffer());
  }
  return null;
}
