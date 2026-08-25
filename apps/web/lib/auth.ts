// ログイン中ユーザーの所属組織を取得するヘルパー。未ログインなら/loginへ redirect する。
//
// 【利用停止をここで止める】
// 支払いは請求書払いのみで、アカウントの発行と停止は本部が行う（ユーザー決定 2026-08-25）。
// 顧客向けの画面はすべてこの関数を通るので、ここで止めれば漏れがない。
// 画面ごとに書くと、新しい画面を作ったときに書き忘れる。
//
// 【分からないときは使わせない】
// org_access の行が無い・読めない場合も停止として扱う。
// 作り忘れで「使えてしまう」より「使えない」ほうが安全（使えないときは連絡が来る）。
import { redirect } from "next/navigation";
import { isActive } from "@ai-nyusatsu-bu/domain";
import { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export type OrgContext = {
  supabase: Supabase;
  userId: string;
  userName: string;
  userEmail: string;
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
    .select("org_id, name")
    .eq("id", user.id)
    .single<{ org_id: string; name: string }>();
  if (!profile) redirect("/login");

  const { data: access } = await supabase
    .from("org_access")
    .select("status")
    .eq("org_id", profile.org_id)
    .maybeSingle<{ status: string }>();
  if (!isActive(access?.status)) redirect("/suspended");

  const { data: organization } = await supabase
    .from("organizations")
    .select("name")
    .eq("id", profile.org_id)
    .single<{ name: string }>();

  return {
    supabase,
    userId: user.id,
    userName: profile.name,
    userEmail: user.email ?? "",
    orgId: profile.org_id,
    orgName: organization?.name ?? "組織未設定",
  };
}
