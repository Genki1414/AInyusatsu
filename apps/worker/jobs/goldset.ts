// ゴールドセットでAI解析の精度を測る（タスク2-6）。
// 参照：docs/ClaudeCode_実装指示書.md §4「ゴールドセット20件で測定」
//
// 【流れ】
//   1. goldset:template  解析済みの案件から確認用のファイルを作る（AIの答えと引用つき）
//   2. 人が引用を読んで「合っている／違う」を判断する。違うものだけ書く
//   3. goldset:measure   DBの解析結果と突き合わせて数字を出す
//
// 判定は packages/domain の evaluateGoldset に置き、ここではDBの読み書きと
// ファイルの入出力だけを行う。
//
// 【引用を並べて、原文を開かずに判断できるようにする】
// 20件×8項目を人が書き写すのは現実的でない。解析結果には項目ごとに引用と出典が
// 付いている（CLAUDE.md 最重要の前提3）ので、それをテンプレートに並べる。
// 人は引用を読んで「合っている／違う」を判断し、違うものだけ書けばよい。
//
// 【見せるのは「保存された値」。AIの生の抽出値ではない】
// measure が突き合わせるのは tenders の列（＝製品が実際に使う値）。
// テンプレートにAIの生の抽出値だけを出すと、生の値と保存値がずれていても
// 「合っていた」と印が付き、その印は保存値のほうに適用されてしまう
// （compareTender は checked かつ expected 未記入なら 正解＝保存値 とする）。
// 書き込みの途中でずれる不具合（タイムゾーンの取り違えなど）を見逃す。
// そこで値は保存値を日本時間で出し、生の抽出値とずれていたら「注意」を付ける。
//
// 【新しく解析したものから選ぶ】
// 測りたいのは「いまのプロンプトの実力」。公告日の新しい順に選ぶと、古いプロンプトで
// 解析した案件が混ざり、直す前と直したあとの結果を1つの数字に混ぜてしまう。
// 解析した日時（tender_analyses.created_at）の新しい順に選ぶ。
//
// 【上書きしない】
// テンプレートを作り直すと、人が書き込んだ正解が消える。
// 既にファイルがあるときは作らずに止める。

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { createServiceClient } from "@ai-nyusatsu-bu/db";
import { toJstTimestamp } from "@ai-nyusatsu-bu/ai";
import { evaluateGoldset, showInstant, type ActualValues, type GoldEntry, type GoldsetReport } from "@ai-nyusatsu-bu/domain";

/** 解析が済んでいる案件だけを対象にする。 */
const ANALYZED_STATUSES = ["解析完了", "公開中", "終了"];

type TenderRow = {
  id: string;
  name: string;
  source_url: string | null;
  submit_deadline: string | null;
  qa_deadline: string | null;
  bid_open_at: string | null;
  qual_category: string | null;
  item: string | null;
  grade: string | null;
  areas: string[] | null;
};

type LotRow = { tender_id: string; trade: string | null };

/** 解析結果の生出力。項目ごとに値・引用・出典が入っている */
type AnalysisRow = { tender_id: string; raw: { basicInfo?: Record<string, unknown> } | null };

/** テンプレートに並べる「保存された値と、その根拠」。 */
type AiAnswer = {
  /** DBに保存されている値（＝製品が実際に使う値）。日時は日本時間 */
  値: string;
  引用: string;
  出典: string;
  /** 保存値とAIの生の抽出値がずれているときだけ入る */
  注意?: string;
};

function showValue(value: unknown): string {
  if (value === null || value === undefined) return "（無し）";
  if (Array.isArray(value)) return value.length === 0 ? "（無し）" : value.join("、");
  return String(value);
}

/** 日時の項目か（保存値を日本時間で見せるもの）。 */
const INSTANT_FIELDS = new Set(["submit_deadline", "qa_deadline", "bid_open_at"]);

/**
 * 1項目を、人が読める形に直す。
 *
 * 値はDBに保存されているもの（＝製品が実際に使う値）を出す。
 * 引用・出典は解析結果の生出力から取る。引用が無い項目は「未確認」として扱う
 * （CLAUDE.md 最重要の前提3）。
 */
function toAnswer(key: string, raw: unknown, stored: unknown): AiAnswer | null {
  if (typeof raw !== "object" || raw === null) return null;
  const entry = raw as { value?: unknown; quote?: unknown; source?: unknown };
  const isInstant = INSTANT_FIELDS.has(key);
  const storedText =
    isInstant && typeof stored === "string" ? showInstant(stored) : showValue(stored ?? null);

  const answer: AiAnswer = {
    値: storedText,
    引用: typeof entry.quote === "string" && entry.quote.trim() !== "" ? entry.quote : "（引用なし＝未確認）",
    出典: typeof entry.source === "string" && entry.source.trim() !== "" ? entry.source : "（出典なし＝未確認）",
  };

  // 保存の途中でずれていないか。ずれていたら黙って隠さず、必ず見せる
  if (isInstant && typeof entry.value === "string" && typeof stored === "string") {
    const wanted = Date.parse(toJstTimestamp(entry.value) ?? "");
    const got = Date.parse(stored);
    if (!Number.isNaN(wanted) && !Number.isNaN(got) && Math.floor(wanted / 60_000) !== Math.floor(got / 60_000)) {
      answer.注意 =
        `AIは「${entry.value}（日本時間）」と読み取りましたが、保存されている値は「${storedText}」です。` +
        "保存の途中でずれています。この項目は expected に正しい値を書いてください";
    }
  }
  return answer;
}

/** テンプレートに並べる項目。人が判断するのに必要なものだけ。 */
const TEMPLATE_FIELDS: { key: string; label: string }[] = [
  { key: "submit_deadline", label: "提出期限" },
  { key: "qa_deadline", label: "質問期限" },
  { key: "bid_open_at", label: "開札" },
  { key: "qual_category", label: "資格区分" },
  { key: "item", label: "営業品目" },
  { key: "grade", label: "等級" },
  { key: "areas", label: "競争参加地域" },
];

export type TemplateResult = { path: string; tenders: number };

/**
 * 確認用のファイルを作る。
 *
 * AIの答えと、その根拠になった引用・出典を並べる。
 *
 * 【引きずられることは承知のうえ】
 * 答えを見せずに書かせるほうが測定としては正確だが、20件×8項目を原文から
 * 書き写す作業になり、現実には誰もやらない。測らないほうが害が大きい。
 * 代わりに「引用が根拠として成立しているか」を見てもらう形にした。
 * 引用が無い項目は「未確認」と表示され、そこは必ず原文で確かめることになる。
 */
export async function writeGoldsetTemplate(path: string, limit: number): Promise<TemplateResult> {
  if (await exists(path)) {
    throw new Error(
      `${path} はすでにあります。作り直すと書き込んだ正解が消えるため、中止しました。` +
        "作り直す場合は、いまのファイルを別名で保存してから削除してください",
    );
  }

  const client = createServiceClient();

  // 新しく解析したものから選ぶ。同じ案件が複数版ある場合は、いちばん新しい解析の日時で並べる
  const { data: recent, error: recentError } = await client
    .from("tender_analyses")
    .select("tender_id, created_at")
    .order("created_at", { ascending: false })
    .limit(limit * 5)
    .returns<{ tender_id: string; created_at: string }[]>();
  if (recentError) throw new Error(`解析結果の取得に失敗しました: ${recentError.message}`);

  // 降順で来るので、最初に出てきたものが最新。重複を落として上位 limit 件
  const order = new Map<string, number>();
  for (const row of recent ?? []) {
    if (!order.has(row.tender_id)) order.set(row.tender_id, order.size);
  }
  const recentIds = [...order.keys()].slice(0, limit);
  if (recentIds.length === 0) {
    throw new Error(
      "解析済みの案件がありません。先に `pnpm --filter worker analyze:pending -- 20` で解析してください（実測 約62円/件）",
    );
  }

  // 保存されている値も引く。テンプレートに出すのは「製品が実際に使う値」
  const { data, error } = await client
    .from("tenders")
    .select("id, name, source_url, submit_deadline, qa_deadline, bid_open_at, qual_category, item, grade, areas")
    .in("id", recentIds)
    .in("collect_status", ANALYZED_STATUSES)
    .returns<TenderRow[]>();
  if (error) throw new Error(`案件の取得に失敗しました: ${error.message}`);

  // 解析の新しい順に戻す（DBの返す順に依存しない）
  const tenders = (data ?? []).sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  if (tenders.length === 0) {
    throw new Error(
      "解析済みの案件がありません。先に `pnpm --filter worker analyze:pending -- 20` で解析してください（実測 約62円/件）",
    );
  }

  // AIの答えと根拠を並べる。これを読んで判断してもらう（原文を開かなくて済むように）
  const answers = await loadAiAnswers(client, tenders);
  const trades = await loadTrades(client, tenders.map((tender) => tender.id));

  const entries = tenders.map((tender) => ({
    tenderName: tender.name,
    tenderId: tender.id,
    // 引用だけで判断できないときに開く。ふだんは見なくてよい
    sourceUrl: tender.source_url,
    // 確認した項目を書く。"期限" / "参加資格" / "業種" / "すべて" とまとめて書ける。
    // 空のままだと、この案件は1件も測らない（見ていないものを正解に数えないため）
    checked: [],
    // AIが間違えていた項目だけ、正しい値を書く。合っていた項目は書かなくてよい。
    // 公告に書かれていないのが正しい項目は null と書く
    expected: {},
    // ↓ここから下は保存されている値と、その根拠。読むだけで、書き換えても測定には影響しない
    保存されている値: { ...(answers.get(tender.id) ?? {}), 業種: showValue(trades.get(tender.id) ?? []) },
  }));

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(entries, null, 2)}\n`, "utf8");
  return { path, tenders: entries.length };
}

export type MeasureResult = GoldsetReport & { skipped: string[] };

/** 記入済みのファイルとDBの解析結果を突き合わせる。 */
export async function measureGoldset(path: string): Promise<MeasureResult> {
  const raw = await readFile(path, "utf8").catch(() => {
    throw new Error(`${path} がありません。先に \`pnpm --filter worker goldset:template\` を実行してください`);
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${path} をJSONとして読めませんでした。カンマや括弧の書き間違いを確認してください`);
  }
  if (!Array.isArray(parsed)) throw new Error(`${path} は配列である必要があります`);

  const entries = parsed as GoldEntry[];
  // 確認した（checked）か、間違いを書いた（expected）案件だけを測る
  const filled = entries.filter(
    (entry) => (entry.checked ?? []).length > 0 || Object.keys(entry.expected ?? {}).length > 0,
  );
  if (filled.length === 0) {
    throw new Error(
      `${path} に確認済みの案件が1件もありません。` +
        'AIの答えと引用を読んで、確認した項目を checked に書いてください（例：["期限"]）',
    );
  }

  const client = createServiceClient();
  const ids = filled.map((entry) => entry.tenderId);

  const [{ data: tenders, error }, lots] = await Promise.all([
    client
      .from("tenders")
      .select("id, name, source_url, submit_deadline, qa_deadline, bid_open_at, qual_category, item, grade, areas")
      .in("id", ids)
      .returns<TenderRow[]>(),
    loadTrades(client, ids),
  ]);
  if (error) throw new Error(`案件の取得に失敗しました: ${error.message}`);

  const byId = new Map((tenders ?? []).map((tender) => [tender.id, tender]));
  const pairs: { entry: GoldEntry; actual: ActualValues }[] = [];
  const skipped: string[] = [];

  for (const entry of filled) {
    const tender = byId.get(entry.tenderId);
    if (!tender) {
      // 案件が消えている／idの書き間違い。黙って飛ばさない
      skipped.push(`${entry.tenderName}（${entry.tenderId}）：案件が見つかりません`);
      continue;
    }
    pairs.push({
      entry,
      actual: {
        submitDeadline: tender.submit_deadline,
        qaDeadline: tender.qa_deadline,
        bidOpenAt: tender.bid_open_at,
        qualCategory: tender.qual_category,
        item: tender.item,
        grade: tender.grade,
        areas: tender.areas ?? [],
        trades: lots.get(tender.id) ?? [],
      },
    });
  }

  return { ...evaluateGoldset(pairs), skipped };
}

/** 案件ごとの業種（数量表の行から重複を除く）。 */
async function loadTrades(
  client: ReturnType<typeof createServiceClient>,
  tenderIds: string[],
): Promise<Map<string, string[]>> {
  const { data, error } = await client.from("tender_lots").select("tender_id, trade").in("tender_id", tenderIds).returns<LotRow[]>();
  if (error) throw new Error(`数量表の取得に失敗しました: ${error.message}`);

  const byTender = new Map<string, Set<string>>();
  for (const row of data ?? []) {
    if (!row.trade) continue;
    const set = byTender.get(row.tender_id) ?? new Set<string>();
    set.add(row.trade);
    byTender.set(row.tender_id, set);
  }
  return new Map([...byTender.entries()].map(([id, set]) => [id, [...set]]));
}

/**
 * 案件ごとの「保存されている値と、その根拠」。
 * 値は tenders の列（製品が使う値）、引用・出典は解析結果の生出力から取る。
 */
async function loadAiAnswers(
  client: ReturnType<typeof createServiceClient>,
  tenders: TenderRow[],
): Promise<Map<string, Record<string, AiAnswer>>> {
  const storedByTender = new Map(tenders.map((tender) => [tender.id, tender as unknown as Record<string, unknown>]));
  const { data, error } = await client
    .from("tender_analyses")
    .select("tender_id, raw")
    .in("tender_id", tenders.map((tender) => tender.id))
    .order("version", { ascending: true })
    .returns<AnalysisRow[]>();
  if (error) throw new Error(`解析結果の取得に失敗しました: ${error.message}`);

  const byTender = new Map<string, Record<string, AiAnswer>>();
  // version の昇順で入れるので、最後に入った＝最新の解析が残る
  for (const row of data ?? []) {
    const basicInfo = row.raw?.basicInfo;
    if (!basicInfo) continue;
    const stored = storedByTender.get(row.tender_id) ?? {};
    const answer: Record<string, AiAnswer> = {};
    for (const { key, label } of TEMPLATE_FIELDS) {
      const value = toAnswer(key, (basicInfo as Record<string, unknown>)[key], stored[key]);
      if (value) answer[label] = value;
    }
    byTender.set(row.tender_id, answer);
  }
  return byTender;
}

async function exists(path: string): Promise<boolean> {
  return readFile(path, "utf8").then(
    () => true,
    () => false,
  );
}
