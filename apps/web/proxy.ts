import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

// Next.js 16でファイル名・関数名が middleware から proxy に変更された。
export function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // api は除く。Webhookの受け口（Resend / Stripe）はログインのCookieを使わず、
  // それぞれ署名で検証している。ここを通すと1リクエストごとに
  // Supabaseの認証サーバーへ無駄な往復が1回増える。
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
