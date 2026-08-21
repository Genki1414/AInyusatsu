"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireOrgContext } from "@/lib/auth";

// 御社（顧客）による正式取得の状況を記録する（docs/資料取得方針_v3.md §5）。
// 本部の取得（tenders.collect_status）とは別物で、org単位のcompany_tendersに持たせる。
export async function setOfficialStatus(tenderId: string, status: "申請中" | "取得済"): Promise<void> {
  const { orgId } = await requireOrgContext();
  const supabase = await createClient();
  const { error } = await supabase
    .from("company_tenders")
    .upsert(
      { org_id: orgId, tender_id: tenderId, official_status: status, official_at: new Date().toISOString() },
      { onConflict: "org_id,tender_id" },
    );
  if (error) throw new Error(error.message);
  revalidatePath(`/tenders/${tenderId}`);
}
