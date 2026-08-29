// 営業AI（Genki1414/eigyouAI）への接続。外部呼び出しはこのファイル経由のみ（CLAUDE.md）。
//
// 【何をして、何をしないか】
// する：条件に合う会社が何社いるかを見る（preview）／送信先リストを作る（lists）／
//       利用者がボタンを押したときに送信を頼む（send）
// しない：無人での送信。定期実行やジョブからここを呼ばない
//         （CLAUDE.md「やらないこと：問い合わせフォームへの無人の自動送信」）。
//         実際にフォームへ送るのは営業AI側で、送信先の除外・回数の上限・
//         停止スイッチもすべて営業AIが持っている。こちらで作り直さない。
//
// 【認証】
// テナントごとの api_key を Authorization: Bearer で送る。
// 顧客が自分の営業AIアカウントで使うので、キーは組織ごとに保存する。
//
// 【業種が対応できないときは呼ばない】
// 営業AIの filters は、知らない業種の値を黙って捨てる。捨てられると業種の条件が
// 消えて「その都道府県の全社」が対象になる。面識の無い会社への一斉送信になるので、
// 業種が対応表に無いときは、そもそもここを呼ばないこと（呼び出し側で止める）。
//
// 【クォータ追加購入（T55。決済まわりはまだ無い）】
// 契約者が基本プラン(既定500通/月)を使い切ったとき、500通/¥5,000単位で枠を
// 追加できるAPIが営業AI側に増えた（`docs/reference/営業AI連携_設計.md`）。
// - GET  /api/tenant/quota                      … 残り通数の表示（テナントのapi_keyで呼べる）
// - POST /api/ops/tenants/<id>/quota-purchase    … 追加購入の記録（本部専用の運用キーで呼ぶ。
//   テナントのapi_keyとは別物）。Stripeの決済成功後に叩く想定だが、Checkout／Webhookの実装は
//   まだ無い（ユーザー決定：決済は後回し）。呼び出し側（将来のWebhookハンドラ）を先に用意する。
//
// 【本部側の接続設定（/admin/sales-ai）】
// 「顧客は営業AIの画面を開かない」（ユーザー決定 2026-08-28）ので、テナントの発行と
// 送信元（顧客名義）の設定は本部が代行する。ここも本部専用の運用キーで呼ぶ。
// - POST /api/ops/tenants                        … テナントを作る。api_keyは一度だけ返る
// - POST /api/tenant/sender-templates (+/activate) … 送信元（顧客名義）を登録して有効化する。
//   ここはテナントごとのapi_key（作ったテナント自身のキー）で呼ぶ。運用キーではない。
//
// 【送信元は契約者本人の名義にする】
// AI入札部が自社で見積依頼を送る送信元（packages/domain/src/sender_identity.ts）とは別物。
// 協力会社開拓の問い合わせフォームに載る送信元は、AI入札部自身のアドレスではなく
// **契約者本人の名義**にする（ユーザー決定 2026-08-28）。

const REQUEST_TIMEOUT_MS = 20_000;

export type OutreachErrorCode =
  | "AUTH_REQUIRED"
  | "RATE_LIMITED"
  | "PARSE_INVALID"
  | "OUT_OF_SCOPE"
  | "UNREACHABLE";

/** 失敗は握りつぶさず、コードを付けて返す（CLAUDE.md）。 */
export class OutreachError extends Error {
  readonly code: OutreachErrorCode;
  constructor(code: OutreachErrorCode, message: string) {
    super(message);
    this.name = "OutreachError";
    this.code = code;
  }
}

export type SalesAiConnection = {
  /** 例：https://sales.example.com（末尾のスラッシュは付けても付けなくてもよい） */
  baseUrl: string;
  apiKey: string;
};

/**
 * 本部専用の運用API（/api/ops/*）を呼ぶための接続情報。
 * テナントごとの SalesAiConnection.apiKey とは別物（営業AI側の SALES_ENGINE_API_KEY 1本を
 * 全テナント共通で使う。テナントの識別はURLのtenantIdで行う）。
 */
export type SalesAiOpsConnection = {
  baseUrl: string;
  opsApiKey: string;
};

/** 営業AIへ渡す絞り込み条件。営業AIが解釈できるキーだけを持つ。 */
export type OutreachFilters = {
  /** 都道府県。営業AI側は47都道府県の名称で固定 */
  prefs: string[];
  /** 営業AI側の業種コード。対応表で変換済みの値だけを入れる */
  trades: string[];
  /** 問い合わせページが分かっている会社だけにする */
  contactReady?: boolean;
};

export type PreviewResult = {
  /** 実際にリストへ入る件数（営業AI側の上限で切られたあとの数） */
  count: number;
  /** 上限で切られる前の件数 */
  countBeforeCap: number;
  capped: boolean;
  /** 確認用の数社。会社名と都道府県だけ */
  sample: { name: string; pref: string | null }[];
};

export type CreatedList = { listId: number; count: number };

export type SendResult = {
  /** 送信を頼んだ会社の数（リストに入っていた件数。営業AI側の target_count） */
  requested: number;
  /** 実際の内訳（成功・失敗・ブロック等）。営業AI側の stats をそのまま渡す */
  stats: { sent: number; failed: number; blocked: number; suppressed: number; stopped: number };
  /** 営業AI側が返したメッセージ（そのまま画面に出す） */
  note: string | null;
};

/** 残り送信可能数（T55）。senders.py の判定と同じ計算式（直近30日ローリング）。 */
export type QuotaStatus = {
  /** テナントの基本クォータ（未設定なら営業AI側の既定値） */
  baseMonthlyQuota: number;
  /** 直近30日分の追加購入合計（T55のquota-purchase） */
  addonQuota30d: number;
  /** base + addon。実際にブロックされるかどうかはこの値で決まる */
  effectiveQuota30d: number;
  /** 直近30日の送信試行数（成否を問わない） */
  used30d: number;
  /** 直近30日の残り送信可能数 */
  remaining30d: number;
  planName: string | null;
};

/** クォータ追加購入（T55）の結果。 */
export type QuotaPurchaseResult = {
  /** 新規に記録されたか。falseならexternal_refが既存と重複していて二重計上しなかった */
  created: boolean;
  quota: QuotaStatus;
};

function endpoint(connection: { baseUrl: string }, path: string): string {
  return `${connection.baseUrl.replace(/\/+$/, "")}${path}`;
}

async function request(
  connection: { baseUrl: string },
  path: string,
  apiKey: string,
  init: { method: "GET" | "POST"; body?: unknown },
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(endpoint(connection, path), {
      method: init.method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    // URLの間違い・停止中・タイムアウト。どれも設定を直せば解決するので理由を残す
    throw new OutreachError("UNREACHABLE", `営業AIに接続できませんでした（${String(err)}）`);
  }

  if (response.status === 401 || response.status === 403) {
    throw new OutreachError("AUTH_REQUIRED", "APIキーが正しくないか、権限がありません");
  }
  if (response.status === 429) {
    throw new OutreachError("RATE_LIMITED", "営業AI側で回数制限に達しました。時間をおいて試してください");
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new OutreachError("OUT_OF_SCOPE", `営業AIがエラーを返しました（HTTP ${response.status}）${detail.slice(0, 200)}`);
  }

  try {
    return await response.json();
  } catch {
    throw new OutreachError("PARSE_INVALID", "営業AIの応答をJSONとして読めませんでした");
  }
}

async function post(connection: SalesAiConnection, path: string, body: unknown): Promise<unknown> {
  return request(connection, path, connection.apiKey, { method: "POST", body });
}

async function get(connection: SalesAiConnection, path: string): Promise<unknown> {
  return request(connection, path, connection.apiKey, { method: "GET" });
}

async function postOps(connection: SalesAiOpsConnection, path: string, body: unknown): Promise<unknown> {
  return request(connection, path, connection.opsApiKey, { method: "POST", body });
}

/** 数値として読めなければ0にせず、読めなかったことを分かるようにする。 */
function requireNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new OutreachError("PARSE_INVALID", `営業AIの応答に${label}がありません`);
  }
  return value;
}

function toFilters(filters: OutreachFilters): Record<string, unknown> {
  return {
    prefs: filters.prefs,
    trades: filters.trades,
    ...(filters.contactReady ? { contact_ready: true } : {}),
  };
}

/**
 * 条件に合う会社が何社いるかを見る。リストは作らない。
 * 参照：eigyouAI api.py `POST /api/tenant/lists/preview`
 */
export async function previewTargets(
  connection: SalesAiConnection,
  filters: OutreachFilters,
): Promise<PreviewResult> {
  if (filters.trades.length === 0) {
    // 業種を空で投げると、その都道府県の全社が対象になる。ここで止める
    throw new OutreachError("OUT_OF_SCOPE", "業種が指定されていません（対応表で営業AI側の業種に変換してください）");
  }
  const payload = (await post(connection, "/api/tenant/lists/preview", { filters: toFilters(filters) })) as Record<
    string,
    unknown
  >;

  const sample = Array.isArray(payload.sample) ? payload.sample : [];
  return {
    count: requireNumber(payload.count, "件数"),
    countBeforeCap: typeof payload.count_before_cap === "number" ? payload.count_before_cap : requireNumber(payload.count, "件数"),
    capped: payload.capped === true,
    sample: sample.slice(0, 10).map((row) => {
      const record = (row ?? {}) as Record<string, unknown>;
      return {
        name: typeof record.name === "string" ? record.name : "（社名不明）",
        pref: typeof record.pref === "string" ? record.pref : null,
      };
    }),
  };
}

/**
 * 送信先リストを作る。**送信はしない。**
 * 作ったあと、営業AIの画面で内容を確かめてから人が送る。
 * 参照：eigyouAI api.py `POST /api/tenant/lists`
 */
export async function createTargetList(
  connection: SalesAiConnection,
  name: string,
  filters: OutreachFilters,
): Promise<CreatedList> {
  if (filters.trades.length === 0) {
    throw new OutreachError("OUT_OF_SCOPE", "業種が指定されていません（対応表で営業AI側の業種に変換してください）");
  }
  const payload = (await post(connection, "/api/tenant/lists", { name, filters: toFilters(filters) })) as Record<
    string,
    unknown
  >;
  if (typeof payload.error === "string") {
    throw new OutreachError("OUT_OF_SCOPE", `リストを作れませんでした：${payload.error}`);
  }
  return { listId: requireNumber(payload.list_id, "リストID"), count: requireNumber(payload.count, "件数") };
}

/**
 * 送信先リストへ送信を頼む。
 *
 * 【呼んでよい場面】
 * 利用者が画面のボタンを押したときだけ。定期実行やジョブから呼ばないこと
 * （CLAUDE.md「やらないこと」）。
 *
 * 【安全装置はすべて営業AI側にある】
 * 送信先の除外（suppression / tenant_exclusions）、回数の上限、停止スイッチは
 * 営業AIの send_campaign() が持っている。こちらで作り直すと二重になり、
 * 片方だけ直したときに食い違う。
 *
 * 参照：eigyouAI api.py `POST /api/tenant/lists/<id>/send`
 *
 * 【応答の形】
 * 営業AI側 target_lists.send_list() の実際の戻り値は
 * `{campaign_id, target_count, dry_run, stats: {sent,failed,blocked,suppressed,stopped}, cancelled_recent}`。
 * トップレベルに sent / count / requested は無い（以前はここを読んでおり、実送信のたびに
 * PARSE_INVALID になっていた。target_count と stats を読むよう修正）。
 */
export async function sendTargetList(
  connection: SalesAiConnection,
  listId: number,
  message: { subject: string; body: string },
): Promise<SendResult> {
  if (message.subject.trim() === "" || message.body.trim() === "") {
    // 空の本文を送ると、受け取った会社に何の用件か分からない
    throw new OutreachError("OUT_OF_SCOPE", "件名と本文の両方が要ります");
  }
  const payload = (await post(connection, `/api/tenant/lists/${listId}/send`, {
    subject: message.subject,
    body: message.body,
    // 営業AI側の既定は dry_run:true（送らない）。実際に送るので明示的に false にする
    dry_run: false,
  })) as Record<string, unknown>;

  if (typeof payload.error === "string") {
    throw new OutreachError("OUT_OF_SCOPE", `送信できませんでした：${payload.error}`);
  }
  const requested = requireNumber(payload.target_count, "送信対象件数（target_count）");
  const statsRaw = payload.stats as Record<string, unknown> | undefined;
  if (!statsRaw) {
    throw new OutreachError("PARSE_INVALID", "営業AIの応答に内訳（stats）がありません");
  }
  const stats = {
    sent: requireNumber(statsRaw.sent, "stats.sent"),
    failed: requireNumber(statsRaw.failed, "stats.failed"),
    blocked: requireNumber(statsRaw.blocked, "stats.blocked"),
    suppressed: requireNumber(statsRaw.suppressed, "stats.suppressed"),
    stopped: requireNumber(statsRaw.stopped, "stats.stopped"),
  };
  return { requested, stats, note: typeof payload.message === "string" ? payload.message : null };
}

/**
 * 残り送信可能数を見る（T55。「今月の残り通数の表示」）。
 * senders.py._check_quota() が実際にブロック判定へ使うのと同じ計算式
 * （直近30日ローリングウィンドウ）なので、ここで見える remaining30d が
 * そのまま「あと何通送れるか」になる。
 *
 * 参照：eigyouAI api.py `GET /api/tenant/quota`
 */
export async function getQuotaStatus(connection: SalesAiConnection): Promise<QuotaStatus> {
  const payload = (await get(connection, "/api/tenant/quota")) as Record<string, unknown>;
  return toQuotaStatus(payload);
}

/**
 * クォータを500通/¥5,000単位で追加購入する（T55）。
 *
 * 【いつ呼ぶか】
 * Stripeで一回払いの決済が成功したあと、その1回だけ。まだCheckout／Webhookの
 * 実装は無い（決済は後回しにするユーザー決定）。将来のWebhookハンドラから
 * このまま呼べるように、アダプタとしては先に用意してある。
 *
 * 【本部専用の運用キーを使う】
 * 送信系（preview/lists/send）と違い、テナントごとの api_key ではなく
 * 本部だけが持つ運用キー（SalesAiOpsConnection.opsApiKey）で呼ぶ。
 * どのテナントかはURLの tenantId（営業AI側の内部tenant.id、数値）で指定する。
 * この数値は `sales_ai_connections.tenant_id` に保存する（本部側の接続設定画面
 * `/admin/sales-ai` が createTenant() を呼んだときに書き込む）。
 *
 * 【二重計上しない】
 * externalRef に Stripe の決済ID等を入れると、Webhookが再送されても
 * 営業AI側で二重に計上しない（db.add_quota_purchase()の冪等性）。
 *
 * 参照：eigyouAI api.py `POST /api/ops/tenants/<id>/quota-purchase`
 */
export async function purchaseQuota(
  connection: SalesAiOpsConnection,
  tenantId: number,
  input: { qty: number; unitPriceYen?: number; externalRef?: string },
): Promise<QuotaPurchaseResult> {
  if (!Number.isInteger(input.qty) || input.qty <= 0) {
    throw new OutreachError("OUT_OF_SCOPE", "qty（追加する送信可能件数）は正の整数で指定してください");
  }
  const payload = (await postOps(connection, `/api/ops/tenants/${tenantId}/quota-purchase`, {
    qty: input.qty,
    ...(input.unitPriceYen !== undefined ? { unit_price_yen: input.unitPriceYen } : {}),
    ...(input.externalRef ? { external_ref: input.externalRef } : {}),
  })) as Record<string, unknown>;

  if (typeof payload.error === "string") {
    throw new OutreachError("OUT_OF_SCOPE", `クォータを追加できませんでした：${payload.error}`);
  }
  return { created: payload.created === true, quota: toQuotaStatus(payload) };
}

function toQuotaStatus(payload: Record<string, unknown>): QuotaStatus {
  const q = payload.quota as Record<string, unknown> | undefined;
  if (!q) {
    throw new OutreachError("PARSE_INVALID", "営業AIの応答にquotaがありません");
  }
  return {
    baseMonthlyQuota: requireNumber(q.base_monthly_send_quota, "base_monthly_send_quota"),
    addonQuota30d: requireNumber(q.addon_quota_30d, "addon_quota_30d"),
    effectiveQuota30d: requireNumber(q.effective_quota_30d, "effective_quota_30d"),
    used30d: requireNumber(q.used_30d, "used_30d"),
    remaining30d: requireNumber(q.remaining_30d, "remaining_30d"),
    planName: typeof q.plan_name === "string" ? q.plan_name : null,
  };
}

/** 新規テナントを作るときの入力。参照：eigyouAI api.py `POST /api/ops/tenants` */
export type CreateTenantInput = {
  /** 契約者の会社名（営業AI側の tenants.name） */
  name: string;
  /** 契約者の送信元メールアドレス（テナントの既定値。個別の送信元は sender-templates で上書きする） */
  senderEmail: string;
  senderName?: string;
  senderAddress?: string;
  optoutUrl?: string;
};
export type CreatedTenant = { tenantId: number; apiKey: string };

/**
 * 本部が営業AIに新しいテナントを作る（契約者1社につき1テナント）。
 *
 * 【一度しか返らないAPIキー】
 * 応答のapiKeyはこの呼び出しの中でしか見えない（営業AI側もハッシュ等では保存していないが、
 * 画面には出さない設計にしている）。呼び出し側で `sales_ai_connections` へすぐ保存すること。
 * 顧客の画面には一切出さない（「顧客は営業AIの画面を開かない」ユーザー決定 2026-08-28）。
 *
 * kindは指定しない（営業AI側の既定 "client"＝販売先。AI入札部の契約者は全員これでよい）。
 *
 * 参照：eigyouAI api.py `POST /api/ops/tenants`
 */
export async function createTenant(
  connection: SalesAiOpsConnection,
  input: CreateTenantInput,
): Promise<CreatedTenant> {
  if (input.name.trim() === "") {
    throw new OutreachError("OUT_OF_SCOPE", "会社名（name）が必要です");
  }
  if (input.senderEmail.trim() === "") {
    throw new OutreachError("OUT_OF_SCOPE", "送信元メールアドレス（senderEmail）が必要です");
  }
  const payload = (await postOps(connection, "/api/ops/tenants", {
    name: input.name,
    sender_email: input.senderEmail,
    ...(input.senderName ? { sender_name: input.senderName } : {}),
    ...(input.senderAddress ? { sender_address: input.senderAddress } : {}),
    ...(input.optoutUrl ? { optout_url: input.optoutUrl } : {}),
  })) as Record<string, unknown>;

  if (typeof payload.error === "string") {
    throw new OutreachError("OUT_OF_SCOPE", `テナントを作れませんでした：${payload.error}`);
  }
  const tenantId = requireNumber(payload.tenant_id, "テナントID");
  if (typeof payload.api_key !== "string" || payload.api_key === "") {
    throw new OutreachError("PARSE_INVALID", "営業AIの応答にAPIキーがありません");
  }
  return { tenantId, apiKey: payload.api_key };
}

/**
 * 送信元（顧客名義）を登録して、そのまま有効化する。
 *
 * 【契約者本人の名義にする】
 * 協力会社開拓の問い合わせフォームに載る送信元は、AI入札部自身のアドレスではなく
 * **契約者本人の名義**にする（ユーザー決定 2026-08-28）。AI入札部が自社で見積依頼を
 * 送るときの送信元（packages/domain/src/sender_identity.ts）とは別の仕組み。
 *
 * 【テナントのapi_keyで呼ぶ】
 * 本部専用の運用キーではなく、createTenant() で作ったそのテナント自身のapi_keyを使う
 * （sender-templatesはテナントスコープのAPIのため）。
 *
 * 【登録だけでなく有効化まで行う】
 * 営業AI側は登録しただけでは送信に使われず、「有効にする」を別に呼ぶ必要がある
 * （eigyouAI api.py の h_tenant_sender_templates_activate）。本部がここで両方まとめて行う。
 *
 * 参照：eigyouAI api.py `POST /api/tenant/sender-templates` `POST /api/tenant/sender-templates/activate`
 */
export type SenderIdentityPayload = {
  templateName: string;
  senderName: string;
  senderEmail: string;
  senderAddress: string;
  optoutUrl?: string;
  lastName?: string;
  firstName?: string;
  lastNameKana?: string;
  firstNameKana?: string;
  postalCode?: string;
  prefecture?: string;
  city?: string;
  block?: string;
  building?: string;
  phone?: string;
  department?: string;
  position?: string;
};

export async function setSenderIdentity(
  connection: SalesAiConnection,
  input: SenderIdentityPayload,
): Promise<{ templateId: number }> {
  if (input.senderName.trim() === "" || input.senderEmail.trim() === "") {
    throw new OutreachError("OUT_OF_SCOPE", "送信元名（senderName）と送信元メールアドレス（senderEmail）が必要です");
  }
  const body = {
    name: input.templateName,
    sender_name: input.senderName,
    sender_email: input.senderEmail,
    sender_address: input.senderAddress,
    ...(input.optoutUrl ? { optout_url: input.optoutUrl } : {}),
    ...(input.lastName ? { last_name: input.lastName } : {}),
    ...(input.firstName ? { first_name: input.firstName } : {}),
    ...(input.lastNameKana ? { last_name_kana: input.lastNameKana } : {}),
    ...(input.firstNameKana ? { first_name_kana: input.firstNameKana } : {}),
    ...(input.postalCode ? { postal_code: input.postalCode } : {}),
    ...(input.prefecture ? { prefecture: input.prefecture } : {}),
    ...(input.city ? { city: input.city } : {}),
    ...(input.block ? { block: input.block } : {}),
    ...(input.building ? { building: input.building } : {}),
    ...(input.phone ? { phone: input.phone } : {}),
    ...(input.department ? { department: input.department } : {}),
    ...(input.position ? { position: input.position } : {}),
  };

  const added = (await post(connection, "/api/tenant/sender-templates", body)) as Record<string, unknown>;
  if (typeof added.error === "string") {
    throw new OutreachError("OUT_OF_SCOPE", `送信元を登録できませんでした：${added.error}`);
  }
  const templateId = requireNumber(added.template_id, "テンプレートID");

  const activated = (await post(connection, "/api/tenant/sender-templates/activate", {
    template_id: templateId,
  })) as Record<string, unknown>;
  if (typeof activated.error === "string") {
    throw new OutreachError(
      "OUT_OF_SCOPE",
      `送信元は登録できましたが、有効化できませんでした：${activated.error}` +
        "（このままだと従来の送信元のまま送信されます。営業AIの画面から手動で有効化してください）",
    );
  }
  return { templateId };
}

/** 営業AI側の業種1件（コードと表示名）。T56。 */
export type TradeEntry = { code: string; label: string };

/**
 * 営業AI側が対応している業種の語彙を見る（T56）。
 *
 * 【何のためにあるか】
 * これまで「AI入札の業種 = 営業AIの業種コード」の対応表（trade_map）は、営業AI側の
 * コード一覧を見る手段が無く、契約者が手で書くしかなかった（company/sales-ai-form.tsx）。
 * このAPIで実際に対応しているコードと表示名が見えるので、対応表を当てずっぽうで
 * 書かずに済む。テナントに依存しない値（どのテナントでも同じ）。
 *
 * 参照：eigyouAI api.py `GET /api/tenant/trades`
 */
export async function listTrades(connection: SalesAiConnection): Promise<TradeEntry[]> {
  const payload = (await get(connection, "/api/tenant/trades")) as Record<string, unknown>;
  const trades = Array.isArray(payload.trades) ? payload.trades : [];
  return trades
    .map((raw) => {
      const row = (raw ?? {}) as Record<string, unknown>;
      return {
        code: typeof row.code === "string" ? row.code : "",
        label: typeof row.label === "string" ? row.label : "",
      };
    })
    .filter((t) => t.code !== "");
}

/** 返信があった1社。結果の取り込み（協力会社として登録する）の元データ。 */
export type RepliedMember = {
  companyId: number;
  name: string;
  pref: string | null;
  phone: string | null;
  email: string | null;
  websiteUrl: string | null;
  contactUrl: string | null;
  repliedAt: string | null;
};

/**
 * 送信先リストのうち、返信があった会社だけを見る。
 *
 * 【誰が「返信あり」を付けるか】
 * 営業AI側でメールの自動取り込みはしていない（β版）。人が営業AIの画面で
 * 「返信あり」を手で付けたものだけがここに出る。
 *
 * 参照：eigyouAI api.py `GET /api/tenant/lists/<id>?status=replied`
 */
export async function listRepliedMembers(connection: SalesAiConnection, listId: number): Promise<RepliedMember[]> {
  const payload = (await get(connection, `/api/tenant/lists/${listId}?status=replied`)) as Record<string, unknown>;
  if (typeof payload.error === "string") {
    throw new OutreachError("OUT_OF_SCOPE", `返信を確認できませんでした：${payload.error}`);
  }
  const members = Array.isArray(payload.members) ? payload.members : [];
  return members.map((raw) => {
    const row = (raw ?? {}) as Record<string, unknown>;
    const str = (key: string): string | null => (typeof row[key] === "string" && row[key] !== "" ? (row[key] as string) : null);
    return {
      companyId: requireNumber(row.id, "会社ID"),
      name: str("name") ?? "（社名不明）",
      pref: str("pref"),
      phone: str("phone"),
      email: str("email"),
      websiteUrl: str("website_url"),
      contactUrl: str("contact_url"),
      repliedAt: str("replied_at"),
    };
  });
}

/**
 * テナント別のKill Switch(送信の即時停止・解除)を操作する。
 *
 * 【いつ呼ぶか】
 * AI入札部側で契約者の組織を停止／再開したとき(本部の /admin/accounts)。
 * 契約が止まっているのに営業AI側の送信だけ動き続けるのはおかしいので連動させる
 * （docs/reference/営業AI連携_設計.md「契約が止まったとき」参照。以前は未連動だった）。
 *
 * 【本部専用の運用キーを使う】
 * scope=tenantのKill Switch操作は営業AI側の運用API。テナントごとのapi_keyではない。
 *
 * 参照：eigyouAI api.py `POST /api/ops/kill-switch`
 */
export async function setKillSwitch(
  connection: SalesAiOpsConnection,
  tenantId: number,
  stopped: boolean,
  reason?: string,
): Promise<void> {
  const payload = (await postOps(connection, "/api/ops/kill-switch", {
    scope: "tenant",
    tenant_id: tenantId,
    stopped,
    ...(reason ? { reason } : {}),
  })) as Record<string, unknown>;
  if (typeof payload.error === "string") {
    throw new OutreachError("OUT_OF_SCOPE", `Kill Switchを操作できませんでした：${payload.error}`);
  }
  if (payload.ok !== true) {
    throw new OutreachError("PARSE_INVALID", "営業AIの応答が想定と異なります(okがtrueではありません)");
  }
}
