// 保存済みの期限を、解析結果の生出力から入れ直す。
//
// 【なぜ必要か】
// 解析プロンプトは "YYYY-MM-DDTHH:mm" を返す（packages/ai/prompts/basic_info.ts）。
// これをタイムゾーンを付けずに timestamptz の列へ入れると、Postgres は
// 「セッションのタイムゾーン」で解釈する。UTCなら日本時間より9時間ずれる。
// 保存前に日本時間へ固定するよう直したが（#84 の toJstTimestamp）、
// それ以前に解析した案件は保存済みの値がずれたまま残る。
//
// 【解析と同じ関数を使う】
// 「日本時間に固定する」規則を2か所に書くと、片方だけ直したときに食い違う。
// 実際、日付だけの値（時刻の記載が無い期限）を取りこぼした。
// 判定は解析と同じ toJstTimestamp に任せる。
//
// 【なぜ解析し直さないか】
// 解析は有料（実測 約62円/件）。正しい値は tender_analyses.raw に残っているので、
// そこから入れ直せば費用はかからない。
//
// 【AIが読み取った値そのものは直さない】
// ここで直すのは「保存のしかた」だけ。AIの読み取りが間違っている場合は
// ここでは直らない（ゴールドセットで測る範囲）。
//
// 【この不具合だと確かめられたものだけ直す】
// 保存値とAIの読み取りが違う理由は、この不具合だけとは限らない。
// コネクタが取得した確定値が入っている列は、AI解析では上書きしていない
// （mergeBasicInfoIntoTender）。そこを「違うから」と書き換えると、
// 出所の確かな値をAIの読み取りで上書きしてしまう。
//
// この不具合は「タイムゾーンの無い文字列がUTCとして解釈された」もので、
// 保存値は必ず『AIの読み取りをUTCとして読んだ値』と一致する。
// 一致するものだけ直し、それ以外は理由を書いて触らない。
//
// 【既定は下見】
// 期限の書き換えは失格に直結する（CLAUDE.md 最重要の前提5）。
// 何がどう変わるかを見てから apply する。

import { createServiceClient } from "@ai-nyusatsu-bu/db";
import { toJstTimestamp } from "@ai-nyusatsu-bu/ai";
import { showInstant } from "@ai-nyusatsu-bu/domain";

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

/** 違いはあるが、この不具合とは言えないもの。触らずに報告する。 */
export type UnexplainedDiff = {
  tenderName: string;
  label: string;
  stored: string;
  fromAnalysis: string;
};

export type RepairResult = {
  checked: number;
  diffs: DeadlineDiff[];
  /** 原因がこの不具合だと確かめられなかったもの（書き換えない） */
  unexplained: UnexplainedDiff[];
  applied: number;
};

/** 生出力から1項目の値を取り出す。 */
function rawValue(basicInfo: Record<string, unknown> | undefined, column: string): string | null {
  const field = basicInfo?.[column];
  if (typeof field !== "object" || field === null) return null;
  const value = (field as { value?: unknown }).value;
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function sameMinute(a: number, b: number): boolean {
  return Math.floor(a / 60_000) === Math.floor(b / 60_000);
}

/**
 * 「タイムゾーンの無い文字列がUTCとして解釈された」ものか。
 *
 * この不具合なら、保存値は必ず『AIの読み取りをUTCとして読んだ値』に一致する。
 * 時刻の無い日付（"2026-09-10"）も同じで、UTCの0時＝日本時間の9時になる。
 * すでにタイムゾーンが付いている読み取りは、この不具合の対象ではない。
 */
export function looksLikeUtcMisread(raw: string, storedAt: number): boolean {
  const trimmed = raw.trim();
  if (/(Z|[+-]\d{2}:?\d{2})$/.test(trimmed)) return false;
  // "2026-09-10" は Date.parse がUTCの0時として読む。"2026-09-10T09:00" は末尾にZを足す
  const asUtc = /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? Date.parse(trimmed) : Date.parse(`${trimmed}Z`);
  return !Number.isNaN(asUtc) && sameMinute(asUtc, storedAt);
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
  if (latest.size === 0) return { checked: 0, diffs: [], unexplained: [], applied: 0 };

  const ids = [...latest.keys()];
  const { data: tenders, error } = await client
    .from("tenders")
    .select("id, name, submit_deadline, qa_deadline, bid_open_at")
    .in("id", ids)
    .returns<TenderRow[]>();
  if (error) throw new Error(`案件の取得に失敗しました: ${error.message}`);

  const diffs: DeadlineDiff[] = [];
  const unexplained: UnexplainedDiff[] = [];
  const patches = new Map<string, Record<string, string>>();

  for (const tender of tenders ?? []) {
    const basicInfo = latest.get(tender.id);
    for (const { column, label } of DEADLINE_FIELDS) {
      const stored = tender[column];
      const raw = rawValue(basicInfo, column);
      const want = toJstTimestamp(raw);
      // 生出力に値が無い項目は触らない（コネクタが入れた確定値かもしれない）
      if (raw === null || want === null || stored === null) continue;

      const storedAt = Date.parse(stored);
      const wantAt = Date.parse(want);
      if (Number.isNaN(storedAt) || Number.isNaN(wantAt)) continue;
      if (sameMinute(storedAt, wantAt)) continue;

      // この不具合なら、保存値は「AIの読み取りをUTCとして読んだ値」に一致する。
      // 一致しないものは別の理由（コネクタの確定値など）。触らずに報告する
      if (!looksLikeUtcMisread(raw, storedAt)) {
        unexplained.push({
          tenderName: tender.name,
          label,
          stored: showInstant(stored),
          fromAnalysis: showInstant(want),
        });
        continue;
      }

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

  if (!apply) return { checked: tenders?.length ?? 0, diffs, unexplained, applied: 0 };

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
  return { checked: tenders?.length ?? 0, diffs, unexplained, applied };
}
