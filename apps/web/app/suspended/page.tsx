// ご利用停止中のお知らせ（タスク4-8の続き）。
//
// 【なぜこの画面が要るか】
// 支払いは請求書払いのみで、発行と停止は本部が行う（ユーザー決定 2026-08-25）。
// 停止した組織が画面を開いたとき、エラーやログイン画面に飛ばすと
// 「壊れている」と受け取られ、問い合わせが本部に来る前に離れてしまう。
// 何が起きているか、どうすれば戻るかを書いた行き先を用意する。
//
// 【requireOrgContext を呼ばない】
// requireOrgContext は停止中ならこの画面へ飛ばす。ここで呼ぶと往復し続ける。
// 認証の確認はこの画面の中で自前に行う。

import { redirect } from "next/navigation";
import { isActive, suspendedMessage } from "@ai-nyusatsu-bu/domain";
import { logout } from "@/app/actions";
import { createClient } from "@/lib/supabase/server";

export default async function SuspendedPage() {
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

  const { data: access } = await supabase
    .from("org_access")
    .select("status, suspended_reason")
    .eq("org_id", profile.org_id)
    .maybeSingle<{ status: string; suspended_reason: string | null }>();

  // 本部が再開したあとにブックマークから開いたとき、ここで止めない
  if (isActive(access?.status)) redirect("/");

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-6">
      <h1 className="text-lg font-semibold text-slate-800">ご利用を停止しています</h1>
      <p className="text-sm leading-relaxed text-slate-700">{suspendedMessage(access?.suspended_reason)}</p>
      <p className="text-sm leading-relaxed text-slate-600">
        再開のご相談・お支払いに関するお問い合わせは、担当者までご連絡ください。
      </p>
      <p className="text-xs text-slate-400">ログイン中：{user.email}</p>
      <form action={logout}>
        <button type="submit" className="rounded border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50">
          ログアウト
        </button>
      </form>
    </main>
  );
}
