// ゴールドセットでAI解析の精度を測る（タスク2-6）。
// 参照：docs/ClaudeCode_実装指示書.md §4「ゴールドセット20件で測定」
//
// 【流れ】
//   1. goldset:template  解析済みの案件から記入用のファイルを作る
//   2. 人が公告を見て正解を書き込む（未記入の項目は測らない）
//   3. goldset:measure   DBの解析結果と突き合わせて数字を出す
//
// 判定は packages/domain の evaluateGoldset に置き、ここではDBの読み書きと
// ファイルの入出力だけを行う。
//
// 【上書きしない】
// テンプレートを作り直すと、人が書き込んだ正解が消える。
// 既にファイルがあるときは作らずに止める。

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { createServiceClient } from "@ai-nyusatsu-bu/db";
import { evaluateGoldset, type ActualValues, type GoldEntry, type GoldsetReport } from "@ai-nyusatsu-bu/domain";

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

export type TemplateResult = { path: string; tenders: number };

/**
 * 記入用のファイルを作る。
 * 正解の欄は空にしておく（AIの答えを見せると、それに引きずられる）。
 */
export async function writeGoldsetTemplate(path: string, limit: number): Promise<TemplateResult> {
  if (await exists(path)) {
    throw new Error(
      `${path} はすでにあります。作り直すと書き込んだ正解が消えるため、中止しました。` +
        "作り直す場合は、いまのファイルを別名で保存してから削除してください",
    );
  }

  const client = createServiceClient();
  const { data, error } = await client
    .from("tenders")
    .select("id, name, source_url")
    .in("collect_status", ANALYZED_STATUSES)
    .order("notice_date", { ascending: false })
    .limit(limit)
    .returns<{ id: string; name: string; source_url: string | null }[]>();
  if (error) throw new Error(`案件の取得に失敗しました: ${error.message}`);

  const tenders = data ?? [];
  if (tenders.length === 0) {
    throw new Error(
      "解析済みの案件がありません。先に `pnpm --filter worker analyze:pending -- 20` で解析してください（実測 約69円/件）",
    );
  }

  const entries = tenders.map((tender) => ({
    tenderId: tender.id,
    tenderName: tender.name,
    // 公告を見るためのリンク。正解はここを見て埋める
    sourceUrl: tender.source_url,
    // 分かる項目だけ埋める。埋めなかった項目は測定から外れる。
    // 「公告に書かれていない」が正解なら null と書く（未記入とは違う）
    expected: {},
    note: "",
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
  const filled = entries.filter((entry) => Object.keys(entry.expected ?? {}).length > 0);
  if (filled.length === 0) {
    throw new Error(`${path} に正解が1件も書かれていません。expected の項目を埋めてから実行してください`);
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

async function exists(path: string): Promise<boolean> {
  return readFile(path, "utf8").then(
    () => true,
    () => false,
  );
}
