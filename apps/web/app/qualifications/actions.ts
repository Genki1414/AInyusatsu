"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireOrgContext } from "@/lib/auth";
import { rematchOrgProposals } from "@/lib/rematch";
import { QUAL_CATEGORIES } from "@/lib/catalog";

const qualificationsSchema = z.object({
  qualCategories: z.array(z.enum(QUAL_CATEGORIES)),
  items: z.array(z.string().min(1)),
  areas: z.array(z.string().min(1)),
  qualValidTo: z.string().nullable(),
  grades: z.record(z.string(), z.string()),
});

export type QualificationsState = { error: string | null; saved: boolean };

export async function saveQualifications(_prevState: QualificationsState, formData: FormData): Promise<QualificationsState> {
  const grades: Record<string, string> = {};
  for (const category of QUAL_CATEGORIES) {
    const value = formData.get(`grade_${category}`);
    if (typeof value === "string" && value.trim() !== "") grades[category] = value.trim();
  }
  const qualValidTo = formData.get("qual_valid_to");

  const parsed = qualificationsSchema.safeParse({
    qualCategories: formData.getAll("qual_categories"),
    items: formData.getAll("items"),
    areas: formData.getAll("areas"),
    qualValidTo: typeof qualValidTo === "string" && qualValidTo !== "" ? qualValidTo : null,
    grades,
  });
  if (!parsed.success) {
    return { error: "入力内容を確認してください", saved: false };
  }

  const { orgId } = await requireOrgContext();
  const supabase = await createClient();
  const { error } = await supabase
    .from("company_profiles")
    .update({
      qual_categories: parsed.data.qualCategories,
      items: parsed.data.items,
      areas: parsed.data.areas,
      qual_valid_to: parsed.data.qualValidTo,
      grades: parsed.data.grades,
    })
    .eq("org_id", orgId);
  if (error) {
    return { error: error.message, saved: false };
  }

  await rematchOrgProposals(supabase, orgId);
  revalidatePath("/qualifications");
  revalidatePath("/proposals");
  revalidatePath("/");
  return { error: null, saved: true };
}
