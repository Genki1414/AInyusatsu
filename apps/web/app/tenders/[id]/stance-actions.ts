"use server";

// 案件ごとの「参加するかどうか」を決める（見送り / 検討 / 保留 / 参加）。
//
// 【work_status は触らない】
// work_status（募集開始 / 積算中 / 提出済）は作業がどこまで進んだかで、
// 応札価格を入れた・書類を出した、といった操作で自動的に動く。
// stance は人がどうしたいかなので、片方を変えてももう片方は動かさない。

import { revalidatePath } from "next/cache";
import { isTenderStance } from "@ai-nyusatsu-bu/domain";
import { requireOrgContext } from "@/lib/auth";

export type StanceState = { error: string | null; message: string | null };

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

export async function setTenderStance(_prev: StanceState, formData: FormData): Promise<StanceState> {
  const { supabase, orgId } = await requireOrgContext();

  const tenderId = text(formData, "tender_id").trim();
  const stance = text(formData, "stance").trim();
  if (tenderId === "") return { error: "案件が指定されていません", message: null };
  // 画面が壊れて知らない値が入ると、一覧の絞り込みから外れて見えなくなる
  if (!isTenderStance(stance)) return { error: `「${stance}」は選べません`, message: null };

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("company_tenders")
    .upsert({ org_id: orgId, tender_id: tenderId, stance, stance_at: now }, { onConflict: "org_id,tender_id" });
  if (error) return { error: `保存できませんでした（${error.message}）`, message: null };

  revalidatePath(`/tenders/${tenderId}`);
  revalidatePath("/tenders");
  revalidatePath("/");
  return {
    error: null,
    message:
      stance === "参加"
        ? "「参加」にしました。下に、提出までの段取りが出ます。"
        : `「${stance}」にしました。`,
  };
}
