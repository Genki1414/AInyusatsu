"use server";

import { revalidatePath } from "next/cache";
import {
  isSelectableProposalStatus,
  isTenderStance,
  stanceForProposalStatus,
  type ProposalStatus,
} from "@ai-nyusatsu-bu/domain";
import { requireOrgContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { saveStance } from "@/lib/stance";

// RLS（proposals: org_id = current_org_id()）により自組織の行しか更新できない。
// requireOrgContext は利用停止も見る。画面から入れなくても、この関数を直接叩けば
// 動いてしまうため、ここでも通す（apps/web/lib/auth.ts）。
//
// 【判断も一緒に動かす】
// この画面の「参加を検討する」「今回は見送る」は proposals.status だけを変えていた。
// ホームの「今日やること」と案件ページの段取りは company_tenders.stance を見るので、
// **ここで押しても「今日やること」に出てこなかった**（2026-10-17 に気づいた）。
// どう動かすかの判定は packages/domain の stanceForProposalStatus に置く。
export async function setProposalStatus(proposalId: string, status: ProposalStatus): Promise<void> {
  const { orgId } = await requireOrgContext();
  // 画面からしか呼ばれない想定だが、直接叩かれても知らない値を入れさせない
  if (!isSelectableProposalStatus(status)) throw new Error(`「${status}」は選べません`);

  const supabase = await createClient();

  // どの案件の提案か。判断（stance）は案件ごとに持つので、先に案件を特定する
  const { data: proposal, error: loadError } = await supabase
    .from("proposals")
    .select("tender_id")
    .eq("id", proposalId)
    .maybeSingle<{ tender_id: string }>();
  if (loadError) throw new Error(loadError.message);
  if (!proposal) throw new Error("提案が見つかりません");

  const { error } = await supabase.from("proposals").update({ status }).eq("id", proposalId);
  if (error) throw new Error(error.message);

  // いまの判断を見てから決める。参加を決めた案件は動かさない
  // （資料を取り、見積を集めている途中の案件をボタン1つで落とさない）
  const { data: companyTender } = await supabase
    .from("company_tenders")
    .select("stance")
    .eq("org_id", orgId)
    .eq("tender_id", proposal.tender_id)
    .maybeSingle<{ stance: string | null }>();
  const current = isTenderStance(companyTender?.stance) ? companyTender.stance : "未定";

  const nextStance = stanceForProposalStatus(status, current);
  if (nextStance !== null) {
    // 提案の扱いは変わっている。判断の保存に失敗したら、黙って進めず知らせる
    const stanceError = await saveStance(supabase, orgId, proposal.tender_id, nextStance);
    if (stanceError !== null) throw new Error(stanceError);
    revalidatePath(`/tenders/${proposal.tender_id}`);
    revalidatePath("/tenders");
  }

  revalidatePath("/proposals");
  revalidatePath("/");
}
