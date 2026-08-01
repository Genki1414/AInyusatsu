"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const signupSchema = z.object({
  orgName: z.string().trim().min(1, "会社名を入力してください"),
  name: z.string().trim().min(1, "お名前を入力してください"),
  email: z.string().trim().email("メールアドレスの形式が正しくありません"),
  password: z.string().min(8, "パスワードは8文字以上で入力してください"),
});

export type SignupState = { error: string | null };

export async function signup(_prevState: SignupState, formData: FormData): Promise<SignupState> {
  const parsed = signupSchema.safeParse({
    orgName: formData.get("orgName"),
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "入力内容を確認してください" };
  }

  const supabase = await createClient();
  // organizations / users / company_profiles の作成はDBトリガー（handle_new_user）が行う。
  // 参照: supabase/migrations/20260803000001_auth_signup_trigger.sql
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { org_name: parsed.data.orgName, name: parsed.data.name },
    },
  });
  if (error) {
    return { error: error.message };
  }

  redirect("/signup/complete");
}
