// 保存済みの期限を、解析結果の生出力から入れ直す。
//
// 【なぜ必要か】
// 解析プロンプトは "YYYY-MM-DDTHH:mm" を返す（packages/ai/prompts/basic_info.ts）。
// これをタイムゾーンを付けずに timestamptz の列へ入れると、Postgres は
// 「セッションのタイムゾーン」で解釈する。UTCなら日本時間より9時間ずれる。
// 保存前に +09:00 を付けるよう直したが、すでに保存済みの案件は直らない。
//
// 【なぜ解析し直さないか】
// 解析は有料（実測 約62円/件）。正しい値は tender_analyses.raw に残っているので、
// そこから入れ直せば費用はかからない。
//
// 【AIが読み取った値そのものは直さない】
// ここで直すのは「保存のしかた」だけ。AIの読み取りが間違っている場合は
// ここでは直らない（ゴールドセットで測る範囲）。
//
// 【既定は下見】
// 期限の書き換えは失格に直結する（CLAUDE.md 最重要の前提5）。
// 何がどう変わるかを見てから apply する。

import { createServiceClient } from "@ai-nyusatsu-bu/db";
import { showInstant, toJstInstant } from "@ai-nyusatsu-bu/domain";

/** 直す対象の列と、解析結果の生出力での名前。 */
const DEADLINE_FIELDS = [
  { column: "submit_deadline", label: "提出期限" },
  { column: "qa_deadline", label: "質問期限" },
  { column: "bid_open_at", label: "開札" },
] as const;

type TenderRow = {
  id: string;
  name: string;
  submit_deadline: string | null;
  qa_deadline: string | null;
  bid_open_at: string | null;
};

type AnalysisRow = { tender_id: string; raw: { basicInfo?: Record<string, unknown> } | null };

export type DeadlineDiff = {
  tenderId: string;
  tenderName: string;
  label: string;
  column: string;
  /** いま保存されている値（日本時間で表示） */
  stored: string;
  /** 入れ直したあとの値（日本時間で表示） */
  fixed: string;
  /** 実際に書き込む値 */
  value: string;
};

export type RepairResult = { checked: number; diffs: DeadlineDiff[]; applied: number };

/** 生出力から1項目の値を取り出す。 */
function rawValue(basicInfo: Record<string, unknown> | undefined, column: string): string | null {
  const field = basicInfo?.[column];
  if (typeof field !== "object" || field === null) return null;
  const value = (field as { value?: unknown }).value;
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

export async function repairDeadlines(apply: boolean): Promise<RepairResult> {
  const client = createServiceClient();

  const { data: analyses, error: analysisError } = await client
    .from("tender_analyses")
    .select("tender_id, raw")
    .order("version", { ascending: true })
    .returns<AnalysisRow[]>();
  if (analysisError) throw new Error(`解析結果の取得に失敗しました: ${analysisError.message}`);

  // version の昇順で入れるので、最後に入った＝最新の解析が残る
  const latest = new Map<string, Record<string, unknown>>();
  for (const row of analyses ?? []) {
    if (row.raw?.basicInfo) latest.set(row.tender_id, row.raw.basicInfo);
  }
  if (latest.size === 0) return { checked: 0, diffs: [], applied: 0 };

  const ids = [...latest.keys()];
  const { data: tenders, error } = await client
    .from("tenders")
    .select("id, name, submit_deadline, qa_deadline, bid_open_at")
    .in("id", ids)
    .returns<TenderRow[]>();
  if (error) throw new Error(`案件の取得に失敗しました: ${error.message}`);

  const diffs: DeadlineDiff[] = [];
  const patches = new Map<string, Record<string, string>>();

  for (const tender of tenders ?? []) {
    const basicInfo = latest.get(tender.id);
    for (const { column, label } of DEADLINE_FIELDS) {
      const stored = tender[column];
      const want = toJstInstant(rawValue(basicInfo, column));
      // 生出力に値が無い項目は触らない（コネクタが入れた確定値かもしれない）
      if (want === null || stored === null) continue;

      const storedAt = Date.parse(stored);
      const wantAt = Date.parse(want);
      if (Number.isNaN(storedAt) || Number.isNaN(wantAt)) continue;
      if (Math.floor(storedAt / 60_000) === Math.floor(wantAt / 60_000)) continue;

      diffs.push({
        tenderId: tender.id,
        tenderName: tender.name,
        label,
        column,
        stored: showInstant(stored),
        fixed: showInstant(want),
        value: want,
      });
      const patch = patches.get(tender.id) ?? {};
      patch[column] = want;
      patches.set(tender.id, patch);
    }
  }

  if (!apply) return { checked: tenders?.length ?? 0, diffs, applied: 0 };

  let applied = 0;
  for (const [tenderId, patch] of patches) {
    const { error: updateError } = await client.from("tenders").update(patch).eq("id", tenderId);
    // 1件失敗しても残りは直す。握りつぶさずに出す
    if (updateError) {
      console.error(`[repair_deadlines] ${tenderId} の更新に失敗しました: ${updateError.message}`);
      continue;
    }
    applied += 1;
  }
  return { checked: tenders?.length ?? 0, diffs, applied };
}
