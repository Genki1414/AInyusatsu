"use server";

// 提出書類チェックリスト（タスク4-6）の更新。
//
// 書類そのもの（tender_forms）は全ユーザー共通なので触らない。企業ごとの進み具合だけを
// company_tender_forms へ書く（CLAUDE.md 最重要の前提1）。
//
// 「書類が1つ足りずに失格」を防ぐのが目的なので、必須書類がすべて完了になるまで
// 提出済みにできない。この判定はサーバー側でもやり直す（画面のボタンを無効にするだけでは、
// 直接リクエストを投げられた場合に素通りしてしまうため）。

import { revalidatePath } from "next/cache";
import {
  buildChecklist,
  checklistProgress,
  isFormState,
  type ChecklistForm,
  type FormState,
} from "@ai-nyusatsu-bu/domain";
import { requireOrgContext } from "@/lib/auth";

export type ChecklistActionState = { error: string | null };

/** 1書類の状態（未着手／作成中／完了）を変える。 */
export async function setFormState(tenderId: string, formId: string, formData: FormData): Promise<void> {
  const state = formData.get("state");
  if (!isFormState(state)) throw new Error(`状態の値が不正です: ${String(state)}`);

  const { supabase, orgId } = await requireOrgContext();

  // 他組織の案件・存在しない書類を書き込まないよう、案件との対応を確認してから入れる。
  const { data: form, error: formError } = await supabase
    .from("tender_forms")
    .select("id")
    .eq("id", formId)
    .eq("tender_id", tenderId)
    .maybeSingle<{ id: string }>();
  if (formError) throw new Error(`提出書類の確認に失敗しました: ${formError.message}`);
  if (!form) throw new Error("提出書類が見つかりません");

  const { error } = await supabase.from("company_tender_forms").upsert(
    {
      org_id: orgId,
      form_id: formId,
      tender_id: tenderId,
      state,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "org_id,form_id" },
  );
  if (error) throw new Error(`提出書類の状態の保存に失敗しました: ${error.message}`);

  revalidatePath(`/tenders/${tenderId}`);
}

/** 提出済みにする。必須書類がすべて完了していなければ拒否する。 */
export async function markSubmitted(
  tenderId: string,
  _prevState: ChecklistActionState,
  _formData: FormData,
): Promise<ChecklistActionState> {
  const { supabase, orgId } = await requireOrgContext();

  const [{ data: forms, error: formsError }, { data: states, error: statesError }] = await Promise.all([
    supabase.from("tender_forms").select("id, name, source, required, note").eq("tender_id", tenderId).returns<ChecklistForm[]>(),
    supabase
      .from("company_tender_forms")
      .select("form_id, state")
      .eq("tender_id", tenderId)
      .returns<{ form_id: string; state: FormState }[]>(),
  ]);
  if (formsError || statesError) {
    console.error("[submission-checklist] チェックリストの読み込みに失敗しました", formsError ?? statesError);
    return { error: "提出状態を確認できませんでした。時間をおいて再度お試しください。" };
  }

  const stateMap = Object.fromEntries((states ?? []).map((s) => [s.form_id, s.state]));
  const progress = checklistProgress(buildChecklist(forms ?? [], stateMap));
  if (!progress.canSubmit) {
    return {
      error:
        progress.total === 0
          ? "提出書類がまだ抽出されていないため、提出済みにできません。"
          : `未完了の書類が${progress.remaining}件あります。すべて完了にしてから提出済みにしてください。`,
    };
  }

  const { error } = await supabase.from("company_tenders").upsert(
    {
      org_id: orgId,
      tender_id: tenderId,
      work_status: "提出済",
      submitted_at: new Date().toISOString(),
    },
    { onConflict: "org_id,tender_id" },
  );
  if (error) {
    console.error("[submission-checklist] 提出済みの記録に失敗しました", error);
    return { error: "提出済みにできませんでした。時間をおいて再度お試しください。" };
  }

  revalidatePath(`/tenders/${tenderId}`);
  return { error: null };
}
