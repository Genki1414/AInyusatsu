// 営業AI（Genki1414/eigyouAI）への接続。外部呼び出しはこのファイル経由のみ（CLAUDE.md）。
//
// 【何をして、何をしないか】
// する：条件に合う会社が何社いるかを見る（preview）／送信先リストを作る（lists）
// しない：送信。フォームへの送信は営業AI側の画面から人が実行する
//         （CLAUDE.md「やらないこと：問い合わせフォームへの自動送信」）。
//         このファイルに送信のエンドポイントは書かない。
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
