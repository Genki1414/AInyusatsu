// 受信済みの返信を、保存してある元データ（inbound_messages.raw）から読み直す（タスク4-3）。
//
// 【なぜ必要か】
// 受信口は届いたJSONを raw に丸ごと残している。項目名の読み違いで本文が空・添付ゼロに
// なっても、元データは手元にある。協力会社にメールを送り直してもらう必要はない。
//
// 【何をするか】
// 1. 届いたJSONの形を出す（項目名と型だけ。base64の中身は出さない）
// 2. 本文と添付をResendのAPIから取り直す（webhookには入っていないため）
// 3. 本文・金額・添付を読み直す
// 4. 宛先から見積を特定し直す（受信時に結びつかなかったものを拾う）
// 5. apply を付けたときだけ書き戻す（既定は下見だけ）
//
// 【なぜAPIから取り直すのか】
// Resendの受信webhookはメタ情報しか送ってこない。本文も添付の中身も入っていない。
// webhookの email_id を使って別途取りに行く必要がある
// （packages/notifications/adapters/resend_inbound.ts）。
//
// 【金額は自動で確定させない】
// parsed_amount は「候補」。quotes.amount には書かない（実装仕様書 §4.4）。
// 人が画面で元の文面と並べて見て、取り込みを押して初めて反映する。

import { createServiceClient } from "@ai-nyusatsu-bu/db";
import {
  attachmentStorageKey,
  describePayload,
  extractAttachments,
  findAttachments,
  findEmailId,
  findMessageBody,
  findRecipients,
  MAX_ATTACHMENT_BYTES,
  parseInboundAddress,
  parseQuoteReply,
  type InboundAttachment,
} from "@ai-nyusatsu-bu/domain";
import { fetchInboundContent } from "@ai-nyusatsu-bu/notifications";

const ATTACHMENT_BUCKET = process.env.QUOTE_ATTACHMENTS_BUCKET || "quote-attachments";

export type ReparseOptions = {
  /** 見る件数（新しい順）。 */
  limit: number;
  /** 本文か添付が空の行だけを対象にする。 */
  onlyIncomplete: boolean;
  /** 書き戻す。付けなければ下見だけ。 */
  apply: boolean;
};

export type ReparseRowResult = {
  id: string;
  receivedAt: string;
  bodyPath: string | null;
  bodyLength: number;
  attachmentsPath: string | null;
  attachmentCount: number;
  storedCount: number;
  amount: number | null;
  matchedQuoteId: string | null;
  newlyMatched: boolean;
  updated: boolean;
  notes: string[];
  /** 届いたJSONの形（項目名と型だけ）。読めなかったときに項目名を確かめるために使う。 */
  shape: string[];
};

export type ReparseResult = {
  examined: number;
  updated: number;
  rows: ReparseRowResult[];
};

type MessageRow = {
  id: string;
  received_at: string;
  org_id: string | null;
  tender_id: string | null;
  partner_id: string | null;
  quote_id: string | null;
  provider_message_id: string | null;
  body: string | null;
  parsed_amount: number | null;
  attachments: unknown;
  raw: unknown;
};

type QuoteRow = {
  id: string;
  partner_id: string;
  quote_requests: { org_id: string; tender_id: string } | { org_id: string; tender_id: string }[] | null;
};

function one<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function storedCount(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

export async function runReparseInbound(options: ReparseOptions): Promise<ReparseResult> {
  const client = createServiceClient();

  const { data, error } = await client
    .from("inbound_messages")
    .select("id, received_at, org_id, tender_id, partner_id, quote_id, provider_message_id, body, parsed_amount, attachments, raw")
    .order("received_at", { ascending: false })
    .limit(options.limit);
  if (error) throw new Error(`受信箱を読めませんでした: ${error.message}`);

  const all = (data ?? []) as MessageRow[];
  const targets = options.onlyIncomplete
    ? all.filter((row) => (row.body ?? "").trim() === "" || storedCount(row.attachments) === 0)
    : all;

  const rows: ReparseRowResult[] = [];
  let updated = 0;

  for (const row of targets) {
    const result = await reparseOne(client, row, options);
    rows.push(result);
    if (result.updated) updated += 1;
  }

  return { examined: targets.length, updated, rows };
}

async function reparseOne(
  client: ReturnType<typeof createServiceClient>,
  row: MessageRow,
  options: ReparseOptions,
): Promise<ReparseRowResult> {
  const notes: string[] = [];
  const payload = row.raw;

  if (payload === null || payload === undefined) {
    notes.push("元データ（raw）が残っていないため読み直せません");
    return {
      id: row.id,
      receivedAt: row.received_at,
      bodyPath: null,
      bodyLength: 0,
      attachmentsPath: null,
      attachmentCount: 0,
      storedCount: storedCount(row.attachments),
      amount: row.parsed_amount,
      matchedQuoteId: row.quote_id,
      newlyMatched: false,
      updated: false,
      notes,
      shape: [],
    };
  }

  // まず、保存してあるwebhookの内容から読めるところを読む
  let body = findMessageBody(payload);
  const attachmentsHit = findAttachments(payload);
  let attachments = extractAttachments(payload);
  let fetchedFrom: string | null = null;

  // webhookには本文も添付の中身も入っていないので、APIから取り直す
  const emailId = findEmailId(payload);
  if (emailId === null) {
    notes.push("受信メールのidが見つからないため、本文と添付を取りに行けません");
  } else {
    try {
      const fetched = await fetchInboundContent(emailId, { maxBytes: MAX_ATTACHMENT_BYTES });
      if (body.text === "") body = findMessageBody(fetched.body);
      if (fetched.attachments.length > 0) attachments = fetched.attachments;
      for (const reason of fetched.skipped) notes.push(reason);
      fetchedFrom = emailId;
    } catch (err) {
      notes.push(`Resendから本文と添付を取得できませんでした: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const parsed = parseQuoteReply(body.text);

  // webhookには本文が入っていない。取得まで成功したうえで空だったときだけ、項目名を疑う
  if (body.path === null && fetchedFrom !== null) {
    notes.push("取得できましたが本文らしい項目がありません（下の「届いたJSONの形」を見て項目名を足してください）");
  }
  if (attachments.length === 0 && attachmentsHit.entries.length > 0) {
    notes.push(`webhookには添付が${attachmentsHit.entries.length}件ありますが、中身を取得できませんでした`);
  }
  if (fetchedFrom !== null && !options.apply) notes.push("apply を付けると、取得した本文と見積書を保存します");

  // 受信時に結びつかなかったものを、宛先から拾い直す
  let quote: QuoteRow | null = null;
  let newlyMatched = false;
  if (row.quote_id === null) {
    const token = findRecipients(payload).map(parseInboundAddress).find((t): t is string => t !== null) ?? null;
    if (token) {
      const { data } = await client
        .from("quotes")
        .select("id, partner_id, quote_requests!inner(org_id, tender_id)")
        .eq("response_token", token)
        .maybeSingle<QuoteRow>();
      quote = data ?? null;
      if (quote) {
        newlyMatched = true;
        notes.push("宛先から見積を特定できました");
      } else {
        notes.push(`宛先のトークンに合う見積がありません（${token}）`);
      }
    } else {
      notes.push("宛先が q.<トークン>@... の形ではないため、どの見積か分かりません");
    }
  }

  const quoteId = quote?.id ?? row.quote_id;
  let stored: StoredAttachment[] = [];

  if (!options.apply) {
    return {
      id: row.id,
      receivedAt: row.received_at,
      bodyPath: body.path,
      bodyLength: body.text.length,
      attachmentsPath: attachmentsHit.path,
      attachmentCount: attachments.length,
      storedCount: storedCount(row.attachments),
      amount: parsed.amount,
      matchedQuoteId: quoteId,
      newlyMatched,
      updated: false,
      notes,
      shape: payloadShape(payload),
    };
  }

  stored = await storeAttachments(client, attachments, {
    quoteId,
    messageId: row.provider_message_id ?? row.id,
  });

  const request_ = one(quote?.quote_requests);

  // 読み直しで空になった項目で、既にある内容を上書きしない（読み直して悪くなることが無いようにする）
  const update: Record<string, unknown> = {};
  if (body.text !== "") update.body = body.text;
  if (parsed.amount !== null) update.parsed_amount = parsed.amount;
  if (stored.length > 0) update.attachments = stored;

  if (quote) {
    update.quote_id = quote.id;
    update.partner_id = quote.partner_id;
    if (request_) {
      update.org_id = request_.org_id;
      update.tender_id = request_.tender_id;
    }
  }

  if (Object.keys(update).length === 0) {
    notes.push("読み直しても新しく取れる内容がありませんでした（書き戻しなし）");
    return {
      id: row.id,
      receivedAt: row.received_at,
      bodyPath: body.path,
      bodyLength: body.text.length,
      attachmentsPath: attachmentsHit.path,
      attachmentCount: attachments.length,
      storedCount: stored.length,
      amount: parsed.amount,
      matchedQuoteId: quoteId,
      newlyMatched,
      updated: false,
      notes,
      shape: payloadShape(payload),
    };
  }

  const { error } = await client.from("inbound_messages").update(update).eq("id", row.id);
  if (error) {
    notes.push(`書き戻しに失敗しました: ${error.message}`);
    return {
      id: row.id,
      receivedAt: row.received_at,
      bodyPath: body.path,
      bodyLength: body.text.length,
      attachmentsPath: attachmentsHit.path,
      attachmentCount: attachments.length,
      storedCount: stored.length,
      amount: parsed.amount,
      matchedQuoteId: quoteId,
      newlyMatched,
      updated: false,
      notes,
      shape: payloadShape(payload),
    };
  }

  // 返信が届いていた事実を記録して催促を止める（受信時に取りこぼしていた分）
  if (quoteId) {
    const { error: repliedError } = await client
      .from("quotes")
      .update({ replied_at: row.received_at })
      .eq("id", quoteId)
      .is("replied_at", null);
    if (repliedError) notes.push(`返信日時の記録に失敗しました: ${repliedError.message}`);
  }

  return {
    id: row.id,
    receivedAt: row.received_at,
    bodyPath: body.path,
    bodyLength: body.text.length,
    attachmentsPath: attachmentsHit.path,
    attachmentCount: attachments.length,
    storedCount: stored.length,
    amount: parsed.amount,
    matchedQuoteId: quoteId,
    newlyMatched,
    updated: true,
    notes,
    shape: payloadShape(payload),
  };
}

/** 届いたJSONの形（項目名と型）を行の一覧で返す。中身は出さない。 */
export function payloadShape(raw: unknown): string[] {
  return describePayload(raw, { maxDepth: 6, maxItems: 3, maxPreview: 60 });
}

type StoredAttachment = { filename: string; storageKey: string; contentType: string | null; bytes: number };

/**
 * 添付をStorageへ保存する。
 * 1件失敗しても他は続ける（見積書が1つでも残るほうがよい）。失敗は握りつぶさず残す。
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
        console.warn(`添付が大きすぎるため保存しませんでした（${attachment.filename} / ${bytes.byteLength}バイト）`);
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
      console.error(`添付の保存に失敗しました（${attachment.filename}）`, err);
    }
  }

  return stored;
}

async function attachmentBytes(attachment: InboundAttachment): Promise<Buffer | null> {
  if (attachment.base64 !== null) return Buffer.from(attachment.base64, "base64");
  if (attachment.url !== null) {
    const response = await fetch(attachment.url);
    if (!response.ok) throw new Error(`取得に失敗しました（HTTP ${response.status}）`);
    return Buffer.from(await response.arrayBuffer());
  }
  return null;
}
