// ログイン中ユーザーの所属組織を取得するヘルパー。未ログインなら/loginへ redirect する。
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export type OrgContext = {
  supabase: Supabase;
  userId: string;
  orgId: string;
  orgName: string;
};

export async function requireOrgContext(): Promise<OrgContext> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("users")
    .select("org_id")
    .eq("id", user.id)
    .single<{ org_id: string }>();
  if (!profile) redirect("/login");

  const { data: organization } = await supabase
    .from("organizations")
    .select("name")
    .eq("id", profile.org_id)
    .single<{ name: string }>();

  return { supabase, userId: user.id, orgId: profile.org_id, orgName: organization?.name ?? "組織未設定" };
}
