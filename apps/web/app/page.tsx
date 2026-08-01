import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { logout } from "./actions";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
        <h1 className="text-xl font-semibold text-slate-800">AI入札部</h1>
        <div className="flex gap-3">
          <Link href="/login" className="rounded bg-slate-800 px-4 py-2 text-sm text-white">
            ログイン
          </Link>
          <Link href="/signup" className="rounded border border-slate-300 px-4 py-2 text-sm text-slate-700">
            新規登録
          </Link>
        </div>
      </main>
    );
  }

  const { data: profile } = await supabase
    .from("users")
    .select("name, org_id")
    .eq("id", user.id)
    .single<{ name: string; org_id: string }>();

  const { data: organization } = profile
    ? await supabase
        .from("organizations")
        .select("name")
        .eq("id", profile.org_id)
        .single<{ name: string }>()
    : { data: null };

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-xl font-semibold text-slate-800">AI入札部</h1>
      <p className="text-sm text-slate-700">
        {profile?.name ?? user.email} さん（{organization?.name ?? "組織未設定"}）
      </p>
      <form action={logout}>
        <button type="submit" className="rounded border border-slate-300 px-4 py-2 text-sm text-slate-700">
          ログアウト
        </button>
      </form>
    </main>
  );
}
