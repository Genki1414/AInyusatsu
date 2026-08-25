// 協力会社からの返信メールを読み解く純ロジック（タスク4-3）。
// 参照：docs/実装仕様書_v1.md §4.4「返信パース（見積の自動取込）」
//
// 【自動で確定させない】
// 仕様書 §4.4：「金額が1つに定まらない場合は null。複数金額（内訳）がある場合は
// 合計を推定せず、人の確認へ回す」。誤った金額はそのまま応札価格まで流れるため、
// ここでは候補を挙げるだけにし、確定は人の操作に委ねる。
//
// 【引用部分を読まない】
// 返信には元の依頼文が引用として付く。そこに過去のやり取りの金額が混ざっていると、
// 今回の見積ではない金額を拾ってしまう。引用を落としてから読む。

/** 返信先に使う、見積ごとの受信アドレスの接頭辞。`q.<token>@<ドメイン>` の形。 */
export const INBOUND_LOCAL_PREFIX = "q.";

/**
 * 見積（quotes.response_token）ごとの受信アドレスを組み立てる。
 * このアドレスへの返信をどの見積のものか判別するために使う。
 */
export function inboundAddress(responseToken: string, domain: string): string {
  return `${INBOUND_LOCAL_PREFIX}${responseToken}@${domain}`;
}

/**
 * 受信アドレスから見積のトークンを取り出す。
 * 形が違うものは null（推測で別の見積に結びつけない）。
 */
export function parseInboundAddress(address: string): string | null {
  const localPart = address.trim().toLowerCase().split("@")[0] ?? "";
  if (!localPart.startsWith(INBOUND_LOCAL_PREFIX)) return null;
  const token = localPart.slice(INBOUND_LOCAL_PREFIX.length);
  // response_token は uuid。形が合わないものは受け付けない
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(token) ? token : null;
}

/**
 * 返信先の一覧を作る。
 *
 * 協力会社が「返信」を1回押すだけで、顧客企業とシステムの両方へ届くように、
 * Reply-To に2つのアドレスを並べる（RFC 5322 は Reply-To に複数のアドレスを許している）。
 *
 * 受信ドメイン（domain）が null のときは、見積ごとの受信アドレスを入れない。
 * 受信できないアドレスを返信先にすると、協力会社に「配信できませんでした」という
 * エラーが返ってしまうため、受信を有効にしたときだけ入れる。
 */
export function replyToList(
  configuredReplyTo: string | null,
  responseToken: string,
  domain: string | null,
): string[] | null {
  const list: string[] = [];
  if (configuredReplyTo) list.push(configuredReplyTo);
  if (domain) list.push(inboundAddress(responseToken, domain));
  return list.length > 0 ? list : null;
}

// ---------------------------------------------------------------------------
// 引用の除去
// ---------------------------------------------------------------------------

/** 引用の始まりを示す行。ここから下は元の依頼文とみなして読まない。 */
const QUOTE_BOUNDARIES = [
  /^-{2,}\s*Original Message\s*-{2,}/i,
  /^-{2,}\s*原文\s*-{2,}/,
  /^_{5,}$/,
  /^On .+ wrote:\s*$/i,
  /^\d{4}年\d{1,2}月\d{1,2}日.*:\s*$/,
  /^\d{4}\/\d{1,2}\/\d{1,2}.*(?:さん|様).*:\s*$/,
];

/**
 * 返信本文から引用部分を落とす。
 * 行頭の「>」と、引用の始まりを示す行より下を捨てる。
 */
export function stripQuotedReply(body: string): string {
  const lines = body.split(/\r?\n/);
  const kept: string[] = [];
  for (const line of lines) {
    if (QUOTE_BOUNDARIES.some((re) => re.test(line.trim()))) break;
    if (/^\s*[>｜|]/.test(line)) continue;
    kept.push(line);
  }
  return kept.join("\n").trim();
}

// ---------------------------------------------------------------------------
// 金額の抽出
// ---------------------------------------------------------------------------

/** 全角の英数字・記号を半角にそろえる。 */
function toHalfWidth(value: string): string {
  return value.replace(/[Ａ-Ｚａ-ｚ０-９，．￥]/g, (c) => {
    if (c === "￥") return "\\";
    return String.fromCharCode(c.charCodeAt(0) - 0xfee0);
  });
}

/**
 * 金額らしき記述をすべて拾う（出現順・重複は除く）。
 *
 * 通貨の目印（円 / ¥ / \）がある数字だけを対象にする。目印の無い数字を拾うと、
 * 日付・電話番号・数量まで金額として扱ってしまう。
 * 「120万円」「1億2000万円」のような表記も読む。
 */
export function extractAmounts(text: string): number[] {
  const normalized = toHalfWidth(text);
  const found: number[] = [];
  const push = (value: number) => {
    if (Number.isFinite(value) && value > 0 && !found.includes(value)) found.push(value);
  };

  // 「1億2000万円」「120万円」「5000万」など、万・億を伴う表記
  const unitPattern = /(?:[¥\\]\s*)?(\d+(?:,\d{3})*(?:\.\d+)?)\s*億\s*(?:(\d+(?:,\d{3})*(?:\.\d+)?)\s*万)?\s*(?:(\d+(?:,\d{3})*)\s*)?円?|(?:[¥\\]\s*)?(\d+(?:,\d{3})*(?:\.\d+)?)\s*万\s*(?:(\d+(?:,\d{3})*)\s*)?円?/g;
  for (const m of normalized.matchAll(unitPattern)) {
    const num = (s: string | undefined) => (s === undefined ? 0 : Number(s.replace(/,/g, "")));
    if (m[1] !== undefined) {
      push(num(m[1]) * 100_000_000 + num(m[2]) * 10_000 + num(m[3]));
    } else if (m[4] !== undefined) {
      push(num(m[4]) * 10_000 + num(m[5]));
    }
  }

  // 「1,200,000円」「¥1200000」など、そのままの表記
  const plainPattern = /(?:[¥\\]\s*(\d{1,3}(?:,\d{3})+|\d+)|(\d{1,3}(?:,\d{3})+|\d+)\s*円)/g;
  for (const m of normalized.matchAll(plainPattern)) {
    const raw = m[1] ?? m[2];
    if (raw === undefined) continue;
    // 万・億の表記で既に読んだ部分は拾わない（「120万円」の「120」を拾わないため）
    const index = m.index ?? 0;
    if (/[億万]/.test(normalized.slice(index, index + m[0].length + 1))) continue;
    push(Number(raw.replace(/,/g, "")));
  }

  return found;
}

/** 見送り・辞退を表す言い回し。 */
const DECLINE_PATTERNS = [/辞退/, /見送/, /お断り/, /対応(?:でき|出来)(?:ま|)せん/, /ご遠慮/];

/** 税込・税抜の明記。 */
const TAX_INCLUDED_PATTERNS = [/税込/, /消費税込/, /内税/];
const TAX_EXCLUDED_PATTERNS = [/税抜/, /税別/, /外税/, /消費税は別/];

export type ParsedQuoteReply = {
  /** 一意に定まった金額。定まらなければ null（推定しない） */
  amount: number | null;
  /** 本文から見つかった金額の候補（出現順・重複を除く） */
  candidates: number[];
  /** 税込と明記されていれば true、税抜なら false、書いていなければ null */
  taxIncluded: boolean | null;
  /** 見送り・辞退の意思が読み取れるか */
  declined: boolean;
  /** 引用を落としたあとの本文（画面に元の文面として並べる） */
  text: string;
};

/**
 * 返信本文を読み、金額の候補と見送りの意思を取り出す。
 *
 * 金額が1つに定まったときだけ amount に入れる。複数見つかった場合は合計も最大値も取らず、
 * candidates に並べて人の確認へ回す（実装仕様書_v1.md §4.4）。
 */
export function parseQuoteReply(body: string): ParsedQuoteReply {
  const text = stripQuotedReply(body);
  const candidates = extractAmounts(text);
  const declined = DECLINE_PATTERNS.some((re) => re.test(text));

  const taxIncluded = TAX_INCLUDED_PATTERNS.some((re) => re.test(text))
    ? true
    : TAX_EXCLUDED_PATTERNS.some((re) => re.test(text))
      ? false
      : null;

  return {
    amount: candidates.length === 1 ? candidates[0] : null,
    candidates,
    taxIncluded,
    declined,
    text,
  };
}
