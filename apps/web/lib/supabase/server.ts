// サーバー（Server Component / Server Function）用のSupabaseクライアント。
// ユーザーのセッションCookieを使ってRLSが効いた状態でアクセスする（service_roleキーは使わない）。
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

type CookieToSet = { name: string; value: string; options: CookieOptions };

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Server Componentのレンダリング中はCookieを書き換えられない。
            // セッションのリフレッシュは proxy.ts 側で行われるため無視してよい。
          }
        },
      },
    },
  );
}
