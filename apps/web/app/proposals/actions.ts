"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

type AllowedStatus = "提案対象" | "検討中" | "対象外";

// RLS（proposals: org_id = current_org_id()）により自組織の行しか更新できない。
export async function setProposalStatus(proposalId: string, status: AllowedStatus): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("proposals").update({ status }).eq("id", proposalId);
  if (error) throw new Error(error.message);
  revalidatePath("/proposals");
  revalidatePath("/");
}
