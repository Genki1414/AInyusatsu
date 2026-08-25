// 受信したメールの本文と添付を取りに行く唯一の呼び出し口（タスク4-3）。
// CLAUDE.md「外部サービスは packages/*/adapters 経由でのみ呼ぶ」
//
// 【なぜ必要か】
// Resendの受信Webhookは**メタ情報しか送ってこない**。実際に届いたJSONは
// 差出人・宛先・件名・添付のファイル名までで、本文（text/html）も添付の中身も入っていない。
// 添付は `{ id, filename, content_type }` だけで、中身も取得先URLも無い。
// 本文と添付は、webhookに入っている email_id を使ってAPIから取りに行く必要がある。
//
// 参照（2026-08-25時点のResend SDK v6の実装で確認）：
//   GET /emails/receiving/{email_id}                     本文（text / html / headers）
//   GET /emails/receiving/{email_id}/attachments         添付の一覧（download_url 付き）
//
// 【download_url は期限付き】
// expires_at を過ぎると取れなくなる。届いたその場で自分のStorageへ写す。

const API_BASE = "https://api.resend.com";
const REQUEST_TIMEOUT_MS = 20_000;

/** 失敗の理由をコードで残す（CLAUDE.md「エラーは握りつぶさない」）。 */
export type InboundFetchErrorCode = "AUTH_REQUIRED" | "RATE_LIMITED" | "PARSE_INVALID" | "OUT_OF_SCOPE";

export class InboundFetchError extends Error {
  readonly code: InboundFetchErrorCode;
  constructor(code: InboundFetchErrorCode, message: string) {
    super(message);
    this.name = "InboundFetchError";
    this.code = code;
  }
}

export type ReceivedAttachment = {
  id: string;
  filename: string | null;
  contentType: string | null;
  /** バイト数。取りに行く前に大きすぎるものを弾くために使う。 */
  size: number | null;
  downloadUrl: string;
  expiresAt: string | null;
};

function apiKey(): string {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new InboundFetchError("AUTH_REQUIRED", "RESEND_API_KEY が設定されていません（.envを確認してください）");
  return key;
}

async function getJson(path: string): Promise<unknown> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${apiKey()}`, Accept: "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (response.status === 401 || response.status === 403) {
    throw new InboundFetchError("AUTH_REQUIRED", `Resendに拒否されました（HTTP ${response.status}）。APIキーの権限を確認してください`);
  }
  if (response.status === 429) {
    throw new InboundFetchError("RATE_LIMITED", "Resendのレート制限に当たりました。時間をおいて読み直してください");
  }
  if (!response.ok) {
    throw new InboundFetchError("OUT_OF_SCOPE", `Resendから取得できませんでした（HTTP ${response.status} ${path}）`);
  }

  try {
    return await response.json();
  } catch {
    throw new InboundFetchError("PARSE_INVALID", `Resendの応答をJSONとして読めませんでした（${path}）`);
  }
}

/**
 * 受信メールの中身を取る。
 *
 * 返り値はAPIの応答をそのまま返す。本文の項目名は
 * packages/domain の findMessageBody() が探すので、ここでは解釈しない
 * （項目名を決め打ちして空になる事故を繰り返さないため）。
 */
export async function fetchReceivedEmail(emailId: string): Promise<unknown> {
  return getJson(`/emails/receiving/${encodeURIComponent(emailId)}`);
}

/** 受信メールの添付の一覧を取る。取得先URL（期限付き）が付いてくる。 */
export async function listReceivedAttachments(emailId: string): Promise<ReceivedAttachment[]> {
  return parseAttachmentList(await getJson(`/emails/receiving/${encodeURIComponent(emailId)}/attachments`));
}

/**
 * 添付一覧の応答を読む。
 * 想定と違う形で返ってきても落とさず、写せるものだけ返す（受信そのものを止めないため）。
 */
export function parseAttachmentList(payload: unknown): ReceivedAttachment[] {
  const rows = Array.isArray((payload as { data?: unknown })?.data) ? (payload as { data: unknown[] }).data : [];

  const attachments: ReceivedAttachment[] = [];
  for (const row of rows) {
    if (typeof row !== "object" || row === null) continue;
    const item = row as Record<string, unknown>;
    const downloadUrl = typeof item.download_url === "string" && item.download_url !== "" ? item.download_url : null;
    // 取得先が無いものは写せない
    if (downloadUrl === null) continue;

    attachments.push({
      id: typeof item.id === "string" ? item.id : "",
      filename: typeof item.filename === "string" && item.filename !== "" ? item.filename : null,
      contentType: typeof item.content_type === "string" ? item.content_type : null,
      size: typeof item.size === "number" ? item.size : null,
      downloadUrl,
      expiresAt: typeof item.expires_at === "string" ? item.expires_at : null,
    });
  }
  return attachments;
}

/**
 * 添付の中身を取る。
 *
 * download_url は署名付きURLなので通常は認証不要だが、拒否された場合だけ
 * APIキーを付けて試す（提供側の仕様変更で認証が要るようになっても止まらないように）。
 */
export async function downloadReceivedAttachment(url: string): Promise<Buffer> {
  let response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });

  if (response.status === 401 || response.status === 403) {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey()}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  }
  if (!response.ok) {
    const code: InboundFetchErrorCode =
      response.status === 401 || response.status === 403 ? "AUTH_REQUIRED" : response.status === 429 ? "RATE_LIMITED" : "OUT_OF_SCOPE";
    throw new InboundFetchError(code, `添付を取得できませんでした（HTTP ${response.status}）`);
  }

  return Buffer.from(await response.arrayBuffer());
}

/**
 * 受信メールの本文と添付を、まとめて取りに行く。
 *
 * 添付は取得先URLの期限が切れる前に中身まで取ってしまう。
 * 1件失敗しても他は続ける（見積書が1つでも残るほうがよい）。失敗は skipped に理由を残す。
 */
export type FetchedInboundContent = {
  /** 本文APIの応答そのまま。項目名の解釈は呼び出し側（findMessageBody）に任せる。 */
  body: unknown;
  /** 中身をbase64で持った添付。保存先の決め方は呼び出し側に任せる。 */
  attachments: { filename: string; contentType: string | null; base64: string; url: null }[];
  /** 取らなかった／取れなかったものの理由。 */
  skipped: string[];
};

export async function fetchInboundContent(emailId: string, options: { maxBytes: number }): Promise<FetchedInboundContent> {
  const body = await fetchReceivedEmail(emailId);
  const skipped: string[] = [];

  let listed: ReceivedAttachment[] = [];
  try {
    listed = await listReceivedAttachments(emailId);
  } catch (err) {
    skipped.push(`添付の一覧を取れませんでした: ${err instanceof Error ? err.message : String(err)}`);
  }

  const attachments: FetchedInboundContent["attachments"] = [];
  for (const attachment of listed) {
    const label = attachment.filename ?? attachment.id;
    if (attachment.size !== null && attachment.size > options.maxBytes) {
      skipped.push(`${label}：大きすぎるため取得しません（${attachment.size}バイト）`);
      continue;
    }
    try {
      const bytes = await downloadReceivedAttachment(attachment.downloadUrl);
      if (bytes.byteLength > options.maxBytes) {
        skipped.push(`${label}：大きすぎるため保存しません（${bytes.byteLength}バイト）`);
        continue;
      }
      attachments.push({
        filename: attachment.filename ?? "attachment",
        contentType: attachment.contentType,
        base64: bytes.toString("base64"),
        url: null,
      });
    } catch (err) {
      skipped.push(`${label}：${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { body, attachments, skipped };
}
