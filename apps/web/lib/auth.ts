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

/** PostgRESTの埋め込みは1対1でも配列で返ることがある。 */
function one<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

type AccessNode = { status: string } | { status: string }[] | null;
type OrgNode = { name: string; org_access: AccessNode } | { name: string; org_access: AccessNode }[] | null;
type ProfileRow = { org_id: string; name: string; organizations: OrgNode };

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

  // 【1回で引く】
  // 以前は users → org_access → organizations を順番に引いていた。全画面がこの関数を
  // 通るので、1画面あたり3往復ぶんの待ち時間が必ず乗っていた。埋め込みで1回にする。
  // organizations と org_access はどちらも org_id でつながっている。
  const { data: profile, error } = await supabase
    .from("users")
    .select("org_id, name, organizations(name, org_access(status))")
    .eq("id", user.id)
    .single<ProfileRow>();

  if (error) {
    // 【なぜ落とさずに前のやり方へ戻すか】
    // ここが失敗すると全画面がログインへ飛ぶ。埋め込みの書き方はDBの外部キーの
    // 付き方に依存し、こちらのテストでは確かめきれない。速くするための変更で
    // 全員が締め出されるのは割に合わないので、失敗したら1件ずつ引く。
    // 握りつぶしてはいない（必ずログに出る）。ここが出続けるなら埋め込みを直すこと。
    console.error(`[auth] まとめて引けませんでした。1件ずつ引きます（user=${user.id}）: ${error.message}`);
    return await loadOneByOne(supabase, user.id, user.email ?? "");
  }
  if (!profile) redirect("/login");

  const organization = one(profile.organizations);
  if (!isActive(one(organization?.org_access)?.status)) redirect("/suspended");

  return {
    supabase,
    userId: user.id,
    userName: profile.name,
    userEmail: user.email ?? "",
    orgId: profile.org_id,
    orgName: organization?.name ?? "組織未設定",
  };
}

/** まとめて引けなかったときの逃げ道。往復は増えるが、動きは以前と同じ。 */
async function loadOneByOne(supabase: Supabase, userId: string, userEmail: string): Promise<OrgContext> {
  const { data: profile } = await supabase
    .from("users")
    .select("org_id, name")
    .eq("id", userId)
    .single<{ org_id: string; name: string }>();
  if (!profile) redirect("/login");

  // 利用権と組織名はどちらも org_id で引ける。順番に待つ理由は無い
  const [{ data: access }, { data: organization }] = await Promise.all([
    supabase.from("org_access").select("status").eq("org_id", profile.org_id).maybeSingle<{ status: string }>(),
    supabase.from("organizations").select("name").eq("id", profile.org_id).single<{ name: string }>(),
  ]);
  if (!isActive(access?.status)) redirect("/suspended");

  return {
    supabase,
    userId,
    userName: profile.name,
    userEmail,
    orgId: profile.org_id,
    orgName: organization?.name ?? "組織未設定",
  };
}
