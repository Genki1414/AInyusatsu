// Supabase生成型（`supabase gen types`）とサーバー専用クエリの置き場。
// DDL確定後（タスク1-2）に `supabase gen types typescript` で types.ts を生成する。

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * service_role キーで接続するサーバー専用クライアント。
 * ワーカー（pg-bossジョブ）や管理系のサーバー処理からのみ呼び出すこと。
 * service_role キーは絶対にクライアント（ブラウザ）に渡さない（CLAUDE.md）。
 */
export function createServiceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が設定されていません（.envを確認してください）",
    );
  }
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
