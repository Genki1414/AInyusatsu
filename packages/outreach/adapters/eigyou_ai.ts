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

const REQUEST_TIMEOUT_MS = 20_000;

/**
 * 直近この日数以内に送った会社は、今回の送信から外す。
 *
 * 営業AIの can_contact() には接触の頻度・回数の制限がもう無い
 * （eigyouAI HANDOFF.md T44 で撤廃。残っているのは配信停止・テナント除外・重複のみ）。
 * 企業データは全テナント共有なので、何もしないと同じ会社へ何度も届く。
 * 相手はこれから協力会社になってもらう会社なので、そこは守る。
 */
export const DEFAULT_CANCEL_RECENT_DAYS = 30;

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

/**
 * 送信の結果。営業AI側の応答をそのまま写す。
 *
 * 【なぜ「頼んだ数」と「送れた数」を分けるか】
 * 営業AIは1回の呼び出しで全件を送るとは限らない。1回あたりの上限
 * （config.FORM_MAX_PER_RUN）・テナントの月/日/時間の上限・Kill Switch・
 * 配信停止のどれかに当たると、対象に入っていても送られない。
 * requested だけを見せると「50社へ送信しました」と出したのに実際は12社、
 * ということが起きる。
 *
 * 参照：eigyouAI target_lists.send_list() の戻り値と senders.send_campaign() の stats。
 */
export type SendResult = {
  /** 対象になった会社の数（送信可能な会社を絞り、cancel_recent_days で外したあと） */
  requested: number;
  /** 実際にフォームへ送れた数 */
  sent: number;
  /** 送信を試みたが失敗した数。営業AI側の送信上限に当たった分もここに入る */
  failed: number;
  /** 配信停止・テナント除外などで送らなかった数 */
  blocked: number;
  /** 恒久的な失敗として配信停止に入れられた数 */
  suppressed: number;
  /** 営業AI側の停止スイッチで止まった数 */
  stopped: number;
  /** cancel_recent_days で対象から外れた数 */
  cancelledRecent: number;
  /**
   * 営業AIが「送っていない」と言っている（dry_run のまま返ってきた）。
   * こちらは常に false を送るので通常あり得ないが、真に受けて
   * 「送信しました」と出すと取り返しがつかないので、必ず見る
   */
  dryRun: boolean;
};

function endpoint(connection: SalesAiConnection, path: string): string {
  return `${connection.baseUrl.replace(/\/+$/, "")}${path}`;
}

async function post(connection: SalesAiConnection, path: string, body: unknown): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(endpoint(connection, path), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${connection.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
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

/** 数値として読めなければ0にせず、読めなかったことを分かるようにする。 */
function requireNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new OutreachError("PARSE_INVALID", `営業AIの応答に${label}がありません`);
  }
  return value;
}

/** 内訳は無くても送信自体は成立している。ここで止めずに0として扱う。 */
function optionalNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
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
 * 送信先リストを作る。**この呼び出しでは送信しない。**
 * 送信は sendTargetList を別に呼ぶ（利用者がボタンを押したとき）。
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
 */
export async function sendTargetList(
  connection: SalesAiConnection,
  listId: number,
  message: { subject: string; body: string },
  cancelRecentDays: number = DEFAULT_CANCEL_RECENT_DAYS,
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
    // 直近に送った会社を外す。同じ会社へ短期間に何度も送ると、
    // これから協力会社になってもらう相手との関係が始まらない。
    // 記録は営業AI側に一本化する（こちらに送信済みの表を持つと必ず食い違う）
    cancel_recent_days: cancelRecentDays,
  })) as Record<string, unknown>;

  if (typeof payload.error === "string") {
    throw new OutreachError("OUT_OF_SCOPE", `送信できませんでした：${payload.error}`);
  }

  // 営業AIは {campaign_id, target_count, dry_run, stats:{sent,failed,blocked,suppressed,stopped},
  // cancelled_recent} を返す（target_lists.send_list()）。
  // 上位に sent は無い。ここを読み違えると、送ったのに「送れませんでした」と出る
  const stats = (payload.stats ?? {}) as Record<string, unknown>;
  return {
    requested: requireNumber(payload.target_count, "対象の件数（target_count）"),
    sent: requireNumber(stats.sent, "送信できた件数（stats.sent）"),
    failed: optionalNumber(stats.failed),
    blocked: optionalNumber(stats.blocked),
    suppressed: optionalNumber(stats.suppressed),
    stopped: optionalNumber(stats.stopped),
    cancelledRecent: optionalNumber(payload.cancelled_recent),
    dryRun: payload.dry_run === true,
  };
}

/** 営業AIのリストに入っている会社1社。協力会社として登録するのに要るものだけ。 */
export type OutreachCompany = {
  /** 営業AI側の companies.id。返信の記録に使う */
  companyId: number;
  name: string;
  pref: string | null;
  tel: string | null;
  email: string | null;
  contactUrl: string | null;
  websiteUrl: string | null;
  /** すでに「返信あり」を記録済みか */
  replied: boolean;
};

async function get(connection: SalesAiConnection, path: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(endpoint(connection, path), {
      headers: { Authorization: `Bearer ${connection.apiKey}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    throw new OutreachError("UNREACHABLE", `営業AIに接続できませんでした（${String(err)}）`);
  }
  if (response.status === 401 || response.status === 403) {
    throw new OutreachError("AUTH_REQUIRED", "APIキーが正しくないか、権限がありません");
  }
  if (response.status === 404) {
    throw new OutreachError("OUT_OF_SCOPE", "営業AI側にこのリストがありません");
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

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/**
 * 実際にフォームへ送れた会社を引く。
 *
 * 【なぜ status=replied ではないか】
 * 営業AIの `replied` は**人が手で立てるフラグ**で、
 * `POST /api/tenant/lists/<id>/outcome` からしかセットされない
 * （api.py `h_tenant_list_member_outcome`：「β版。メール自動取得等はしない」）。
 * 営業AIはメールボックスを見ていないので、待っていても永遠に立たない。
 *
 * 返信は打診文に書いた連絡先＝**利用者自身のメールに届く**。
 * だから「送った会社」を出して、返信をもらった会社を利用者に選んでもらう。
 *
 * 参照：eigyouAI api.py `GET /api/tenant/lists/<id>?status=success`
 */
export async function listSentCompanies(
  connection: SalesAiConnection,
  listId: number,
): Promise<OutreachCompany[]> {
  const payload = (await get(connection, `/api/tenant/lists/${listId}?status=success&limit=200`)) as Record<
    string,
    unknown
  >;
  const members = Array.isArray(payload.members) ? payload.members : [];
  return members.map((row) => {
    const record = (row ?? {}) as Record<string, unknown>;
    return {
      companyId: typeof record.id === "number" ? record.id : 0,
      name: text(record.name) ?? "（社名不明）",
      pref: text(record.pref),
      tel: text(record.phone),
      email: text(record.email),
      contactUrl: text(record.contact_url),
      websiteUrl: text(record.website_url),
      replied: record.replied === 1 || record.replied === true,
    };
  });
}

/**
 * 「返信があった」を営業AI側にも記録する。
 *
 * 協力会社として登録したときに呼ぶ。**両方の記録を揃えるため。**
 * 営業AIのダッシュボードは `target_list_members.replied` を数えていて
 * （`h_tenant_dashboard`）、こちらだけで登録すると営業AI側は
 * 「1件も返信が無い」ままになる。
 *
 * 参照：eigyouAI api.py `POST /api/tenant/lists/<id>/outcome`
 */
export async function markReplied(
  connection: SalesAiConnection,
  listId: number,
  companyId: number,
  memo: string | null,
): Promise<void> {
  const payload = (await post(connection, `/api/tenant/lists/${listId}/outcome`, {
    company_id: companyId,
    field: "replied",
    value: true,
    ...(memo ? { memo } : {}),
  })) as Record<string, unknown>;
  if (typeof payload.error === "string") {
    throw new OutreachError("OUT_OF_SCOPE", `返信を記録できませんでした：${payload.error}`);
  }
}
