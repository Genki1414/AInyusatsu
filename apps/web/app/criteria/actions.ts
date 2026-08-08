"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireOrgContext } from "@/lib/auth";
import { rematchOrgProposals } from "@/lib/rematch";

function linesToList(value: FormDataEntryValue | null): string[] {
  if (typeof value !== "string") return [];
  return value
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

function toNullableNumber(value: FormDataEntryValue | null): number | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

const criteriaSchema = z.object({
  name: z.string().min(1, "セット名を入力してください"),
  items: z.array(z.string()),
  areas: z.array(z.string()),
  keywords: z.array(z.string()),
  ngWords: z.array(z.string()),
  minBudget: z.number().nullable(),
  maxBudget: z.number().nullable(),
  minDays: z.number().int().min(0),
  active: z.boolean(),
});

export type CriteriaState = { error: string | null; savedId: string | null };

export async function saveCriteriaSet(_prevState: CriteriaState, formData: FormData): Promise<CriteriaState> {
  const id = formData.get("id");
  const parsed = criteriaSchema.safeParse({
    name: formData.get("name"),
    items: formData.getAll("items"),
    areas: formData.getAll("areas"),
    keywords: linesToList(formData.get("keywords")),
    ngWords: linesToList(formData.get("ng_words")),
    minBudget: toNullableNumber(formData.get("min_budget")),
    maxBudget: toNullableNumber(formData.get("max_budget")),
    minDays: Number(formData.get("min_days") || 5),
    active: formData.get("active") === "on",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "入力内容を確認してください", savedId: null };
  }

  const { orgId } = await requireOrgContext();
  const supabase = await createClient();
  const row = {
    org_id: orgId,
    name: parsed.data.name,
    items: parsed.data.items,
    areas: parsed.data.areas,
    keywords: parsed.data.keywords,
    ng_words: parsed.data.ngWords,
    min_budget: parsed.data.minBudget,
    max_budget: parsed.data.maxBudget,
    min_days: parsed.data.minDays,
    active: parsed.data.active,
  };

  let savedId: string | null = null;
  if (typeof id === "string" && id !== "") {
    const { error } = await supabase.from("criteria_sets").update(row).eq("id", id);
    if (error) return { error: error.message, savedId: null };
    savedId = id;
  } else {
    const { data, error } = await supabase.from("criteria_sets").insert(row).select("id").single<{ id: string }>();
    if (error) return { error: error.message, savedId: null };
    savedId = data.id;
  }

  await rematchOrgProposals(supabase, orgId);
  revalidatePath("/criteria");
  revalidatePath("/proposals");
  revalidatePath("/");
  return { error: null, savedId };
}
