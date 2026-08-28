"use server";

// 自社情報の設定。
// 会社名は協力会社へ送るメール（挨拶・署名）と画面のヘッダーに使われる。
// 一般管理費率・目標利益率は原価集計（タスク4-5）で応札価格の案を出すのに使う。
// 返信先は、協力会社へ送るメールに Reply-To として付ける。協力会社が返信すると
// ここへ届く。未設定なら登録者のアドレスに落ちるので、返信が宙に浮くことはない。
//
// 担当者名（users.name）は、協力会社へ送るメールの署名に使う。新規登録時に空欄だと
// メールアドレスが入るため（20260803000001_auth_signup_trigger.sql）、あとから直せるようにする。
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { looksLikeEmail, normalizeMailingIdentity } from "@ai-nyusatsu-bu/domain";
import { createClient } from "@/lib/supabase/server";
import { requireOrgContext } from "@/lib/auth";
import { syncSalesAiSenderIdentity } from "@/lib/sales_ai_sync";

// 率は画面では%で入力し、DBには小数（0.12など）で持つ（organizations.overhead_rate は numeric(5,4)）。
const percent = (label: string) =>
  z
    .string()
    .trim()
    .refine((v) => v !== "", `${label}を入力してください`)
    .refine((v) => /^\d+(\.\d+)?$/.test(v), `${label}は半角数字で入力してください`)
    .transform((v) => Number(v))
    .refine((v) => v >= 0 && v <= 100, `${label}は0〜100の範囲で入力してください`)
    .transform((v) => Math.round(v * 100) / 10000);

const companyNameSchema = z.object({
  orgName: z.string().trim().min(1, "会社名を入力してください").max(100, "会社名は100文字以内で入力してください"),
  overheadRate: percent("一般管理費率"),
  profitRate: percent("目標利益率"),
  // 空欄なら未設定（登録者のアドレスを使う）。形が違うものは受け付けない
  replyTo: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v))
    .refine((v) => v === null || looksLikeEmail(v), "返信先はメールアドレスの形で入力してください"),
});

export type CompanyNameState = { error: string | null; saved: boolean; syncNote: string | null };

/**
 * 自社情報（会社名・一般管理費率・目標利益率・返信先）を変更する。
 * organizationsのRLSは自組織のみ許可しているため、ユーザーのセッションのまま更新できる。
 *
 * 会社名・返信先は営業AI（eigyouAI）の送信元テンプレートの元になるため、保存できたら
 * そのまま同期する（T55の続き。手で二重に入れさせない）。テナントがまだ無い組織では
 * 何もしない。同期の失敗はこの保存自体を失敗にはしない（自社情報は保存できるようにする）。
 */
export async function saveCompanyName(_prevState: CompanyNameState, formData: FormData): Promise<CompanyNameState> {
  const parsed = companyNameSchema.safeParse({
    orgName: formData.get("org_name"),
    overheadRate: String(formData.get("overhead_rate") ?? ""),
    profitRate: String(formData.get("profit_rate") ?? ""),
    replyTo: String(formData.get("reply_to") ?? ""),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "入力内容を確認してください", saved: false, syncNote: null };
  }

  const { orgId } = await requireOrgContext();
  const supabase = await createClient();
  const { error } = await supabase
    .from("organizations")
    .update({
      name: parsed.data.orgName,
      overhead_rate: parsed.data.overheadRate,
      profit_rate: parsed.data.profitRate,
      reply_to: parsed.data.replyTo,
    })
    .eq("id", orgId);
  if (error) {
    console.error("[company] 自社情報の保存に失敗しました", error);
    return { error: "保存に失敗しました。時間をおいて再度お試しください。", saved: false, syncNote: null };
  }

  const sync = await syncSalesAiSenderIdentity(supabase, orgId);

  // ヘッダーの表示名は全画面で使うため、まとめて再検証する。
  revalidatePath("/", "layout");
  return {
    error: null,
    saved: true,
    syncNote: sync.ok ? "営業AI側の送信元にも反映しました。" : null,
  };
}


const userNameSchema = z.object({
  name: z.string().trim().min(1, "担当者名を入力してください").max(50, "担当者名は50文字以内で入力してください"),
});

export type UserNameState = { error: string | null; saved: boolean };

/**
 * ログイン中のユーザーの担当者名を変更する。
 *
 * usersのRLSは「同じorgなら誰の行でも触れる」ため、ここでは必ず自分の行だけに絞る
 * （他のメンバーの名前を書き換えられないようにする）。
 */
export async function saveUserName(_prevState: UserNameState, formData: FormData): Promise<UserNameState> {
  const parsed = userNameSchema.safeParse({ name: formData.get("user_name") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "入力内容を確認してください", saved: false };
  }

  const { userId } = await requireOrgContext();
  const supabase = await createClient();
  const { error } = await supabase.from("users").update({ name: parsed.data.name }).eq("id", userId);
  if (error) {
    console.error("[company] 担当者名の保存に失敗しました", error);
    return { error: "保存に失敗しました。時間をおいて再度お試しください。", saved: false };
  }

  // 署名に使う値なので、案件画面のプレビューも含めて再検証する
  revalidatePath("/", "layout");
  return { error: null, saved: true };
}

export type MailingIdentityState = { error: string | null; saved: boolean; syncNote: string | null };

/**
 * 郵送名義（姓名・フリガナ・住所・電話番号・部署・役職）を保存する。
 *
 * 協力会社開拓の問い合わせフォームに載る送信元＝契約者本人の名義にする
 * （AI入札部自身のアドレスにはしない。ユーザー決定 2026-08-28）。全項目任意
 * （まだ営業AIのテナントが無い組織でも先に入力しておける）。保存できたら
 * 営業AI側の送信元テンプレートへそのまま同期する（手で二重に入れさせない）。
 */
export async function saveMailingIdentity(
  _prevState: MailingIdentityState,
  formData: FormData,
): Promise<MailingIdentityState> {
  const identity = normalizeMailingIdentity({
    lastName: String(formData.get("last_name") ?? ""),
    firstName: String(formData.get("first_name") ?? ""),
    lastNameKana: String(formData.get("last_name_kana") ?? ""),
    firstNameKana: String(formData.get("first_name_kana") ?? ""),
    postalCode: String(formData.get("postal_code") ?? ""),
    prefecture: String(formData.get("prefecture") ?? ""),
    city: String(formData.get("city") ?? ""),
    block: String(formData.get("block") ?? ""),
    building: String(formData.get("building") ?? ""),
    phone: String(formData.get("phone") ?? ""),
    department: String(formData.get("department") ?? ""),
    position: String(formData.get("position") ?? ""),
  });

  const { orgId } = await requireOrgContext();
  const supabase = await createClient();
  const { error } = await supabase.from("organization_mailing_identity").upsert({
    org_id: orgId,
    last_name: identity.lastName,
    first_name: identity.firstName,
    last_name_kana: identity.lastNameKana,
    first_name_kana: identity.firstNameKana,
    postal_code: identity.postalCode,
    prefecture: identity.prefecture,
    city: identity.city,
    block: identity.block,
    building: identity.building,
    phone: identity.phone,
    department: identity.department,
    position: identity.position,
    updated_at: new Date().toISOString(),
  });
  if (error) {
    console.error("[company] 郵送名義の保存に失敗しました", error);
    return { error: "保存に失敗しました。時間をおいて再度お試しください。", saved: false, syncNote: null };
  }

  const sync = await syncSalesAiSenderIdentity(supabase, orgId);
  return {
    error: null,
    saved: true,
    syncNote: sync.ok ? "営業AI側の送信元にも反映しました。" : null,
  };
}
