"use server";

// アカウント追加の依頼（顧客側）。
//
// 【ここでは発行しない】
// 追加するたびに月5,000円が発生する（docs/reference/価格.md）。
// 請求書払いなので、料金が増える操作を顧客が自分で完了できてはいけない。
// ここで作るのは依頼だけ。発行は本部の /admin/accounts から行う。

import { revalidatePath } from "next/cache";
import { isAlreadyRegistered, requestAcceptedMessage, validateAccountRequest } from "@ai-nyusatsu-bu/domain";
import { requireOrgContext } from "@/lib/auth";

export type AccountRequestState = { error: string | null; message: string | null };

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

/** Postgres の一意制約違反。同じ人を二重に依頼したとき。 */
const UNIQUE_VIOLATION = "23505";

export async function requestAccount(
  _prev: AccountRequestState,
  formData: FormData,
): Promise<AccountRequestState> {
  const { supabase, orgId, userId } = await requireOrgContext();

  const validated = validateAccountRequest({
    name: text(formData, "name"),
    email: text(formData, "email"),
    note: text(formData, "note"),
  });
  if (!validated.ok) return { error: validated.error, message: null };
  const { name, email, note } = validated.value;

  // すでにログインがあるアドレスは、発行しようとしても Supabase 側で失敗する。
  // 本部が発行して初めて分かる、では遅い
  const { data: logins, error: loginsError } = await supabase
    .from("users")
    .select("email")
    .eq("org_id", orgId)
    .returns<{ email: string }[]>();
  if (loginsError) {
    return { error: `ログインの一覧を読めませんでした（${loginsError.message}）`, message: null };
  }
  if (isAlreadyRegistered(logins ?? [], email)) {
    return { error: `${email} はすでにログインとして登録されています。`, message: null };
  }

  const { error } = await supabase.from("account_requests").insert({
    org_id: orgId,
    name,
    email,
    note,
    requested_by: userId,
  });
  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      return { error: `${email} はすでに依頼済みです。発行までお待ちください。`, message: null };
    }
    return { error: `依頼を送れませんでした（${error.message}）`, message: null };
  }

  revalidatePath("/billing");
  // いくら増えるかを、承った時点でもう一度伝える
  return { error: null, message: requestAcceptedMessage(name, (logins?.length ?? 0) + 1) };
}

/**
 * 依頼を取り下げる。
 *
 * 本部が発行したあとは取り下げられない（status が '依頼中' の行だけを対象にする）。
 * 発行済みのものを消せると、請求の根拠が消えてしまう。
 */
export async function withdrawAccountRequest(
  _prev: AccountRequestState,
  formData: FormData,
): Promise<AccountRequestState> {
  const { supabase, orgId } = await requireOrgContext();
  const requestId = text(formData, "request_id").trim();
  if (requestId === "") return { error: "取り下げる依頼が指定されていません", message: null };

  const { data, error } = await supabase
    .from("account_requests")
    .update({ status: "取り下げ", resolved_at: new Date().toISOString() })
    .eq("id", requestId)
    .eq("org_id", orgId)
    .eq("status", "依頼中")
    .select("name")
    .maybeSingle<{ name: string }>();
  if (error) return { error: `取り下げできませんでした（${error.message}）`, message: null };
  if (!data) {
    return { error: "この依頼は取り下げできません。すでに発行済みの可能性があります。", message: null };
  }

  revalidatePath("/billing");
  return { error: null, message: `${data.name} さまの依頼を取り下げました。`, };
}
