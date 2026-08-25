// 受信メールのJSONから本文と添付を取り出す（タスク4-3）。
//
// 【なぜ「決め打ち」をやめたか】
// 最初は data.text / data.attachments という項目名を決め打ちで読んでいた。
// 実際に届いた1通目は、記録は残ったのに本文が空・添付ゼロ・金額NULLだった（2026-08-25）。
// providerの項目名が想定と違っただけで、中身は inbound_messages.raw に丸ごと残っていた。
//
// 項目名を当てにいくと、providerの仕様が少し変わるたびに同じ事故が起きる。
// そこで、JSON全体をたどって「本文らしいもの」「添付らしいもの」を探す方式にする。
// 名前の候補を増やせば済むし、外れても describePayload() で中身の形を見て直せる。
//
// 【本文の探し方】
// 浅い階層を先に見る（幅優先）。添付やヘッダの中にも text / content といった項目が
// あるため、その枝には入らない（添付の中身を本文と取り違えない）。

/** 本文（プレーンテキスト）としてありうる項目名。小文字で比較する。 */
const BODY_TEXT_KEYS = ["text", "plain", "plain_body", "plainbody", "text_body", "textbody", "body_plain", "stripped_text", "body"];

/** 本文（HTML）としてありうる項目名。テキストが見つからなかったときだけ使う。 */
const BODY_HTML_KEYS = ["html", "body_html", "htmlbody", "html_body", "stripped_html"];

/** 添付の一覧としてありうる項目名。 */
const ATTACHMENT_KEYS = ["attachments", "attachment", "files"];

/** 本文を探すときに入らない枝。ここに本文らしい項目名があっても本文ではない。 */
const BODY_SKIP_KEYS = new Set([...ATTACHMENT_KEYS, "headers", "header", "envelope", "raw", "inline_images", "inlineimages"]);

/** たどるノード数の上限。壊れたJSONや巨大なJSONで止まらなくなるのを防ぐ。 */
const MAX_NODES = 5000;

export type BodyHit = {
  /** 見つかった本文。見つからなければ空文字。 */
  text: string;
  /** どの項目から取れたか（例：`$.data.text`）。診断用。見つからなければ null。 */
  path: string | null;
  /** テキストから取れたか、HTMLから起こしたか。 */
  format: "text" | "html" | null;
};

export type AttachmentsHit = {
  entries: unknown[];
  /** どの項目から取れたか（例：`$.data.attachments`）。診断用。 */
  path: string | null;
};

type Node = { node: unknown; path: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 項目名の大文字小文字ゆれ（contentType / content_type）に耐えるための索引。先に出てきた方を採る。 */
function byLowerKey(node: Record<string, unknown>): Map<string, { key: string; value: unknown }> {
  const map = new Map<string, { key: string; value: unknown }>();
  for (const [key, value] of Object.entries(node)) {
    const lower = key.toLowerCase();
    if (!map.has(lower)) map.set(lower, { key, value });
  }
  return map;
}

/** JSONを幅優先でたどる。visitがtrueを返したら打ち切る。 */
function walk(payload: unknown, visit: (node: Record<string, unknown>, path: string) => boolean, skip: Set<string>): void {
  const queue: Node[] = [{ node: payload, path: "$" }];
  const seen = new Set<unknown>();
  let visited = 0;

  while (queue.length > 0 && visited < MAX_NODES) {
    const current = queue.shift();
    if (!current) break;
    const { node, path } = current;

    if (Array.isArray(node)) {
      node.forEach((child, index) => queue.push({ node: child, path: `${path}[${index}]` }));
      continue;
    }
    if (!isPlainObject(node)) continue;
    // 循環参照でも止まるようにする
    if (seen.has(node)) continue;
    seen.add(node);
    visited += 1;

    if (visit(node, path)) return;

    for (const [key, value] of Object.entries(node)) {
      if (skip.has(key.toLowerCase())) continue;
      if (isPlainObject(value) || Array.isArray(value)) queue.push({ node: value, path: `${path}.${key}` });
    }
  }
}

/**
 * 本文を取り出す。
 *
 * プレーンテキストを優先し、無ければHTMLからテキストを起こす。
 * どちらも無ければ空文字を返す（例外にしない。受信そのものは記録したいため）。
 */
export function findMessageBody(payload: unknown): BodyHit {
  const found: { text: BodyHit | null; html: { value: string; path: string } | null } = { text: null, html: null };

  walk(
    payload,
    (node, path) => {
      const map = byLowerKey(node);
      for (const candidate of BODY_TEXT_KEYS) {
        const hit = map.get(candidate);
        if (hit && typeof hit.value === "string" && hit.value.trim() !== "") {
          found.text = { text: hit.value, path: `${path}.${hit.key}`, format: "text" };
          return true;
        }
      }
      if (found.html === null) {
        for (const candidate of BODY_HTML_KEYS) {
          const hit = map.get(candidate);
          if (hit && typeof hit.value === "string" && hit.value.trim() !== "") {
            found.html = { value: hit.value, path: `${path}.${hit.key}` };
            break;
          }
        }
      }
      return false;
    },
    BODY_SKIP_KEYS,
  );

  if (found.text !== null) return found.text;
  if (found.html !== null) return { text: htmlToText(found.html.value), path: found.html.path, format: "html" };
  return { text: "", path: null, format: null };
}

/** 添付の一覧を取り出す。見つからなければ空。 */
export function findAttachments(payload: unknown): AttachmentsHit {
  let found: AttachmentsHit = { entries: [], path: null };

  walk(
    payload,
    (node, path) => {
      const map = byLowerKey(node);
      for (const candidate of ATTACHMENT_KEYS) {
        const hit = map.get(candidate);
        if (hit && Array.isArray(hit.value)) {
          found = { entries: hit.value, path: `${path}.${hit.key}` };
          return true;
        }
      }
      return false;
    },
    // 添付は添付の中に入れ子にならない。ヘッダの中も見ない
    new Set(["headers", "header", "raw"]),
  );

  return found;
}

/** 宛先としてありうる項目名。 */
const RECIPIENT_KEYS = ["to", "recipient", "recipients", "to_address", "toaddress", "delivered_to", "envelope_to"];

/**
 * 宛先の一覧を取り出す。`名前 <addr@example.com>` の形でもアドレスだけにする。
 * どの見積への返信かはここから決まるので、取りこぼすと結びつかなくなる。
 */
export function findRecipients(payload: unknown): string[] {
  const addresses: string[] = [];

  walk(
    payload,
    (node) => {
      const map = byLowerKey(node);
      for (const candidate of RECIPIENT_KEYS) {
        const hit = map.get(candidate);
        if (!hit) continue;
        for (const value of Array.isArray(hit.value) ? hit.value : [hit.value]) {
          if (typeof value === "string") addresses.push(...emailAddresses(value));
          // { address: "...", name: "..." } の形にも耐える
          else if (isPlainObject(value)) {
            const inner = byLowerKey(value).get("address") ?? byLowerKey(value).get("email");
            if (inner && typeof inner.value === "string") addresses.push(...emailAddresses(inner.value));
          }
        }
      }
      // 宛先は複数の階層に分かれて入っていることがあるので、最後までたどる
      return false;
    },
    new Set([...ATTACHMENT_KEYS]),
  );

  return [...new Set(addresses)];
}

/** 受信メールのidとしてありうる項目名。 */
const EMAIL_ID_KEYS = ["email_id", "emailid", "message_uuid"];

/**
 * 受信メールのidを取り出す。
 *
 * Resendの受信Webhookは本文も添付の中身も送ってこない。このidを使って
 * 別途APIから取りに行く（packages/notifications/adapters/resend_inbound.ts）。
 * これが取れないと本文と見積書が永久に空のままになるので、専用に探す。
 */
export function findEmailId(payload: unknown): string | null {
  const found: { id: string | null } = { id: null };

  walk(
    payload,
    (node) => {
      const map = byLowerKey(node);
      for (const candidate of EMAIL_ID_KEYS) {
        const hit = map.get(candidate);
        if (hit && typeof hit.value === "string" && hit.value.trim() !== "") {
          found.id = hit.value.trim();
          return true;
        }
      }
      return false;
    },
    // 添付にも id はあるが、それは添付のidであってメールのidではない
    new Set([...ATTACHMENT_KEYS, "headers", "header"]),
  );

  return found.id;
}

/** 文字列からメールアドレスだけを取り出す。カンマ区切りや `名前 <addr>` に耐える。 */
export function emailAddresses(value: string): string[] {
  const matches = value.match(/[^\s<>,;"]+@[^\s<>,;"]+/g);
  return matches ? matches.map((v) => v.trim()).filter((v) => v !== "") : [];
}

/** HTMLからテキストを起こす。改行を残す（見積の条件が箇条書きで来ることが多いため）。 */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|table)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&amp;/gi, "&")
    .split("\n")
    .map((line) => line.replace(/[ \t ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export type DescribeOptions = {
  /** これより深い階層は省略する。 */
  maxDepth?: number;
  /** 配列はこの数まで見せる。 */
  maxItems?: number;
  /** これより長い文字列は中身を見せず長さだけ書く（base64の添付を吐き出さないため）。 */
  maxPreview?: number;
};

/**
 * 届いたJSONの形を、行の一覧として返す。
 *
 * 【中身をそのまま出さない】
 * 添付はbase64で数十万文字になる。長い文字列は長さだけ書く。
 * 何が入っているかではなく、どういう項目名で入っているかを見るための道具。
 */
export function describePayload(payload: unknown, options: DescribeOptions = {}): string[] {
  const maxDepth = options.maxDepth ?? 6;
  const maxItems = options.maxItems ?? 3;
  const maxPreview = options.maxPreview ?? 60;
  const lines: string[] = [];

  const visit = (value: unknown, path: string, depth: number): void => {
    if (Array.isArray(value)) {
      lines.push(`${path} : 配列(${value.length}件)`);
      if (depth >= maxDepth) return;
      value.slice(0, maxItems).forEach((child, index) => visit(child, `${path}[${index}]`, depth + 1));
      if (value.length > maxItems) lines.push(`${path}[…] : 残り${value.length - maxItems}件は省略`);
      return;
    }
    if (isPlainObject(value)) {
      const keys = Object.keys(value);
      lines.push(`${path} : オブジェクト(${keys.length}項目)`);
      if (depth >= maxDepth) return;
      for (const key of keys) visit(value[key], `${path}.${key}`, depth + 1);
      return;
    }
    if (typeof value === "string") {
      const preview = value.length <= maxPreview ? ` ${JSON.stringify(value)}` : "";
      lines.push(`${path} : 文字列(${value.length}文字)${preview}`);
      return;
    }
    if (value === null) {
      lines.push(`${path} : null`);
      return;
    }
    lines.push(`${path} : ${typeof value} ${JSON.stringify(value)}`);
  };

  visit(payload, "$", 0);
  return lines;
}
