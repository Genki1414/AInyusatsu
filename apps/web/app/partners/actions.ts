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

function toNullableString(value: FormDataEntryValue | null): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  return value.trim();
}

const partnerSchema = z.object({
  name: z.string().min(1, "会社名を入力してください"),
  person: z.string().nullable(),
  tel: z.string().nullable(),
  email: z.string().email("メールアドレスの形式が正しくありません").nullable().or(z.literal("").transform(() => null)),
  base: z.string().nullable(),
  trades: z.array(z.string()),
  areas: z.array(z.string()),
  rating: z.number().min(0).max(5).nullable(),
  memo: z.string().nullable(),
  active: z.boolean(),
});

export type PartnerState = { error: string | null; savedId: string | null };

export async function savePartner(_prevState: PartnerState, formData: FormData): Promise<PartnerState> {
  const id = formData.get("id");
  const emailRaw = toNullableString(formData.get("email"));
  const parsed = partnerSchema.safeParse({
    name: formData.get("name"),
    person: toNullableString(formData.get("person")),
    tel: toNullableString(formData.get("tel")),
    email: emailRaw ?? "",
    base: toNullableString(formData.get("base")),
    trades: formData.getAll("trades"),
    areas: linesToList(formData.get("areas")),
    rating: toNullableNumber(formData.get("rating")),
    memo: toNullableString(formData.get("memo")),
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
    person: parsed.data.person,
    tel: parsed.data.tel,
    email: parsed.data.email,
    base: parsed.data.base,
    trades: parsed.data.trades,
    areas: parsed.data.areas,
    rating: parsed.data.rating,
    memo: parsed.data.memo,
    active: parsed.data.active,
  };

  let savedId: string | null = null;
  if (typeof id === "string" && id !== "") {
    const { error } = await supabase.from("partners").update(row).eq("id", id);
    if (error) return { error: error.message, savedId: null };
    savedId = id;
  } else {
    const { data, error } = await supabase.from("partners").insert(row).select("id").single<{ id: string }>();
    if (error) return { error: error.message, savedId: null };
    savedId = data.id;
  }

  // 協力会社の保有状況はfit.tsの「協力会社の保有」（10点）に影響するため、他の設定変更と
  // 同様に自組織のproposalsを再照合する。
  await rematchOrgProposals(supabase, orgId);
  revalidatePath("/partners");
  revalidatePath("/proposals");
  revalidatePath("/");
  return { error: null, savedId };
}
