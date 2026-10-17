// 案件の判断（company_tenders.stance）の書き込み。
//
// 判断は案件ページ・案件一覧・提案一覧の3か所から変わる。実装を分けると、
// 片方だけ直して食い違う（検証を忘れる・stance_at を入れ忘れる）。
// ここに1つだけ置く。
//
// revalidatePath はここでは呼ばない。どの画面を作り直すかは呼び出し側が決める
// （"use server" ではないので、この関数はサーバーアクションから呼ぶ）。

import { isTenderStance } from "@ai-nyusatsu-bu/domain";
import type { requireOrgContext } from "@/lib/auth";

type Supabase = Awaited<ReturnType<typeof requireOrgContext>>["supabase"];

/**
 * 判断を保存する。保存できなければ、画面に出せる理由を返す（成功なら null）。
 * 失敗を握りつぶさない（CLAUDE.md）。
 */
export async function saveStance(
  supabase: Supabase,
  orgId: string,
  tenderId: string,
  stance: string,
): Promise<string | null> {
  if (tenderId.trim() === "") return "案件が指定されていません";
  // 画面が壊れて知らない値が入ると、一覧の絞り込みから外れて見えなくなる
  if (!isTenderStance(stance)) return `「${stance}」は選べません`;

  const { error } = await supabase
    .from("company_tenders")
    .upsert(
      { org_id: orgId, tender_id: tenderId, stance, stance_at: new Date().toISOString() },
      { onConflict: "org_id,tender_id" },
    );
  return error ? `保存できませんでした（${error.message}）` : null;
}
