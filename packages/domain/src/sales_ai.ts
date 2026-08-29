// 営業AI連携の設定まわりの純ロジック（9月分：協力会社開拓）。
//
// 【なぜ業種の対応表が要るか】
// AI入札部の業種（電気・清掃・警備…）と、営業AI側の業種コード（tobi・tosou…）は
// 別の語彙。営業AIには語彙を返すAPIが無いので、こちらからは知りようがない。
// 顧客が対応表を書く形にする。
//
// 【対応が無い業種では呼ばない】
// 営業AIの filters は、知らない業種の値を黙って捨てる。捨てられると業種の条件が
// 消えて「その都道府県の全社」が対象になる。面識の無い会社への一斉送信になるので、
// 対応表に無い業種は、候補を探す操作そのものをさせない。

/** 「AI入札部の業種 = 営業AIの業種コード」の対応表。 */
export type TradeMap = Record<string, string>;

export type TradeMapParse = { ok: true; value: TradeMap } | { ok: false; error: string };

/** 1行に1件までにする。多すぎる設定は書き間違いの元なので上限を置く。 */
export const TRADE_MAP_MAX_ROWS = 100;

/**
 * 設定画面の入力（1行1件の「電気 = denki」）を対応表にする。
 *
 * 空行と # で始まる行は読み飛ばす。
 * 同じ業種が2回出てきたら、どちらが効いているか分からなくなるので誤りとして止める。
 */
export function parseTradeMap(raw: string): TradeMapParse {
  const value: TradeMap = {};
  const lines = raw.split("\n");
  let rows = 0;

  for (const [index, line] of lines.entries()) {
    const text = line.trim();
    if (text === "" || text.startsWith("#")) continue;

    const at = text.indexOf("=");
    if (at < 0) {
      return { ok: false, error: `${index + 1}行目：「業種 = 営業AIの業種コード」の形で書いてください（${text}）` };
    }
    const trade = text.slice(0, at).trim();
    const code = text.slice(at + 1).trim();
    if (trade === "" || code === "") {
      return { ok: false, error: `${index + 1}行目：業種と業種コードの両方を書いてください（${text}）` };
    }
    if (value[trade] !== undefined) {
      return { ok: false, error: `${index + 1}行目：${trade} が2回出てきます。どちらを使うか決められません` };
    }
    rows += 1;
    if (rows > TRADE_MAP_MAX_ROWS) {
      return { ok: false, error: `対応表は${TRADE_MAP_MAX_ROWS}行までにしてください` };
    }
    value[trade] = code;
  }
  return { ok: true, value };
}

/** 対応表を設定画面の表示に戻す。 */
export function formatTradeMap(map: TradeMap): string {
  return Object.entries(map)
    .map(([trade, code]) => `${trade} = ${code}`)
    .join("\n");
}

/** その業種を営業AIの業種コードに直せるか。直せなければ null。 */
export function toSalesAiTrade(map: TradeMap, trade: string): string | null {
  const code = map[trade.trim()];
  return typeof code === "string" && code.trim() !== "" ? code.trim() : null;
}

export type SalesAiSettingsInput = { baseUrl: string; apiKey: string; tradeMapText: string };
export type SalesAiSettingsParse =
  | { ok: true; value: { baseUrl: string; apiKey: string; tradeMap: TradeMap } }
  | { ok: false; error: string };

/**
 * 接続設定の入力を確かめる。
 * URLは https だけを通す。APIキーを平文の通信に載せないため。
 */
export function validateSalesAiSettings(input: SalesAiSettingsInput): SalesAiSettingsParse {
  const baseUrl = input.baseUrl.trim().replace(/\/+$/, "");
  const apiKey = input.apiKey.trim();

  if (baseUrl === "") return { ok: false, error: "営業AIのURLを入力してください" };
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    return { ok: false, error: `URLの形で入力してください（例：https://sales.example.com）` };
  }
  if (parsed.protocol !== "https:") {
    return { ok: false, error: "https:// のURLを指定してください（APIキーを平文で送らないため）" };
  }
  if (apiKey === "") return { ok: false, error: "APIキーを入力してください" };

  const map = parseTradeMap(input.tradeMapText);
  if (!map.ok) return { ok: false, error: map.error };

  return { ok: true, value: { baseUrl, apiKey, tradeMap: map.value } };
}

/** 画面に出すときの伏せ字。控えと見比べられる程度に末尾だけ残す。 */
export function maskApiKey(apiKey: string | null): string {
  if (!apiKey || apiKey.length < 4) return "未設定";
  return `${"•".repeat(8)}${apiKey.slice(-4)}`;
}

/**
 * 履行場所から都道府県を取り出す。営業AIの絞り込みは都道府県で行うため。
 * 取り出せなければ null。推測で別の県を入れない。
 */
export const PREFECTURES = [
  "北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県",
  "茨城県", "栃木県", "群馬県", "埼玉県", "千葉県", "東京都", "神奈川県",
  "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県",
  "岐阜県", "静岡県", "愛知県", "三重県", "滋賀県", "京都府", "大阪府",
  "兵庫県", "奈良県", "和歌山県", "鳥取県", "島根県", "岡山県", "広島県",
  "山口県", "徳島県", "香川県", "愛媛県", "高知県", "福岡県", "佐賀県",
  "長崎県", "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県",
] as const;

export function prefectureFromPlace(place: string | null): string | null {
  if (!place) return null;
  for (const pref of PREFECTURES) {
    if (place.includes(pref)) return pref;
  }
  return null;
}

/**
 * 本部の一覧に出す、その組織の設定の状態。
 *
 * 【なぜ「設定済み」を細かく分けるか】
 * 契約したのに設定が途中で止まっている組織を、一覧を開いただけで見つけたい。
 * キーだけ入れて対応表が空、保存したが疎通確認をしていない、確認したが失敗した——
 * このどれも「案件画面にボタンが出ない」という同じ結果になり、
 * 顧客からは「使えません」としか言えない。本部側で区別できるようにする。
 */
export type SalesAiSetupState =
  | "未設定"
  | "対応表が空"
  | "未確認"
  | "確認に失敗"
  | "設定済み";

export type SalesAiSetupInput = {
  baseUrl: string | null;
  hasKey: boolean;
  tradeCount: number;
  checkedAt: string | null;
  checkError: string | null;
};

/** 直すべき順に判定する。手前で止まっているものを先に出す。 */
export function salesAiSetupState(input: SalesAiSetupInput): SalesAiSetupState {
  // URLとキーの両方が要る。片方だけでは呼べない
  if (!input.baseUrl || input.baseUrl.trim() === "" || !input.hasKey) return "未設定";
  // 対応表が空だと、どの業種でもボタンが出ない
  if (input.tradeCount === 0) return "対応表が空";
  // 失敗の記録が残っているなら、確認済みでも直っていない
  if (input.checkError !== null && input.checkError !== "") return "確認に失敗";
  if (input.checkedAt === null) return "未確認";
  return "設定済み";
}

/** その状態で、利用者が案件画面から候補を探せるか。 */
export function canOutreach(state: SalesAiSetupState): boolean {
  // 「未確認」でも呼べる。確認していないだけで設定は揃っている。
  // 「確認に失敗」も止めない。前回の失敗が一時的なもの（営業AIの再起動など）のことがあり、
  // 押してみて初めて直っていると分かる。理由は押したときに出る
  return state === "設定済み" || state === "未確認" || state === "確認に失敗";
}

/**
 * 送信の結果を、利用者に見せる1文にする。
 *
 * 【なぜ「頼んだ数」をそのまま出さないか】
 * 営業AIは1回の呼び出しで全件を送るとは限らない。1回あたりの上限
 * （eigyouAI config.FORM_MAX_PER_RUN＝50）・月/日/時間の上限・停止スイッチ・
 * 配信停止のどれかに当たると、対象に入っていても送られない。
 * 「50社へ送信しました」と出したのに実際は12社、では嘘になる。
 *
 * 送れなかった分があることは必ず伝える。**送信は取り消せないので、
 * 利用者が「全部送った」と思い込んだまま次の案件へ進むのがいちばん困る。**
 */
export type OutreachSendCounts = {
  requested: number;
  sent: number;
  failed: number;
  blocked: number;
  suppressed: number;
  stopped: number;
  dryRun: boolean;
};

export type OutreachSendSummary = {
  /** 画面に出す文 */
  message: string;
  /** 1社も送れていない。この場合は成功として見せない */
  nothingSent: boolean;
  /** 送り残しがある。もう一度押せば続きから送れる */
  hasRemaining: boolean;
};

export function summarizeOutreachSend(counts: OutreachSendCounts): OutreachSendSummary {
  // 営業AIが「送っていない」と言っているのに送信しましたとは書けない
  if (counts.dryRun) {
    return {
      message:
        "営業AIが送信しない設定（ドライラン）で処理しました。1社にも届いていません。本部にご連絡ください。",
      nothingSent: true,
      hasRemaining: true,
    };
  }

  const parts: string[] = [];
  if (counts.stopped > 0) parts.push(`営業AI側で送信が停止されているため${counts.stopped}社`);
  if (counts.blocked > 0) parts.push(`配信停止・除外設定により${counts.blocked}社`);
  if (counts.failed > 0) parts.push(`送信できず${counts.failed}社（送信上限に達した分を含みます）`);
  const detail = parts.length > 0 ? `送れなかった内訳：${parts.join("／")}。` : "";

  if (counts.sent === 0) {
    return {
      message: `1社にも送信できませんでした。${detail}`,
      nothingSent: true,
      hasRemaining: counts.requested > 0,
    };
  }

  const remaining = counts.requested - counts.sent;
  if (remaining > 0) {
    return {
      message:
        `${counts.sent}社へ送信しました。残り${remaining}社はまだ送れていません。${detail}` +
        "もう一度「送信する」を押すと、送れていない会社にだけ送ります。",
      nothingSent: false,
      hasRemaining: true,
    };
  }
  return {
    message: `${counts.sent}社へ送信しました。`,
    nothingSent: false,
    hasRemaining: false,
  };
}

// ── 本部が営業AIのテナントを作る（/admin/sales-ai） ─────────────────
//
// 【なぜ本部側にも要るか】
// 「顧客は営業AIの画面を開かない」（ユーザー決定 2026-08-28）ので、テナントの発行は
// 本部が代行する。本部がキーを顧客に見せずそのまま保存できるようにする。

function looksLikeEmailAddress(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export type ProvisionTenantInput = { orgName: string; senderEmail: string };
export type ProvisionTenantValidation = { ok: true; value: ProvisionTenantInput } | { ok: false; error: string };

/** 「営業AIにテナントを作る」フォームの入力を確かめる。 */
export function validateProvisionTenant(input: { orgName: string; senderEmail: string }): ProvisionTenantValidation {
  const orgName = input.orgName.trim();
  const senderEmail = input.senderEmail.trim().toLowerCase();
  if (orgName === "") return { ok: false, error: "会社名を入力してください" };
  if (orgName.length > 100) return { ok: false, error: "会社名は100文字以内で入力してください" };
  if (senderEmail === "") return { ok: false, error: "送信元メールアドレスを入力してください" };
  if (!looksLikeEmailAddress(senderEmail)) return { ok: false, error: "メールアドレスの形で入力してください" };
  return { ok: true, value: { orgName, senderEmail } };
}

// 送信元（顧客名義）の入力・検証は packages/domain/src/mailing_identity.ts に移した
// （本部が毎回手入力する画面をやめ、顧客の自社情報から自動同期する形にしたため。
// ユーザー決定 2026-08-28その2。apps/web/lib/sales_ai_sync.ts参照）。
