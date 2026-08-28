// 営業AIの接続設定を読む（9月分：協力会社開拓）。
//
// 【なぜ service_role で読むか】
// 営業AIのテナントとAPIキーは本部が作る。顧客は営業AIの画面を開かない
// （ユーザー決定 2026-08-28 / docs/reference/営業AI連携_設計.md）。
// キーを顧客のRLSの範囲で読めるようにすると、取り出して営業AIのAPIを直に叩ける。
// 件数を見てから送る・対応表に無い業種では送らない、という歯止めが全部外れるので、
// api_key は authenticated から列の読み取り権限を外してある
// （supabase/migrations/20260828000002_sales_ai_connections_admin.sql）。
//
// 【他組織の設定を読めないようにする】
// この関数は org_id を必ず受け取り、その1行だけを引く。
// 呼び出し側は requireOrgContext / requireAdmin で確かめた org_id を渡すこと。
// 画面から来た値をそのまま渡さない。

import { createServiceClient } from "@ai-nyusatsu-bu/db";
import type { TradeMap } from "@ai-nyusatsu-bu/domain";

export type SalesAiConnection = {
  baseUrl: string;
  /** 実物。画面へ渡さない（表示は maskApiKey） */
  apiKey: string;
  tradeMap: TradeMap;
  checkedAt: string | null;
  checkError: string | null;
};

type Row = {
  base_url: string;
  api_key: string;
  trade_map: TradeMap | null;
  checked_at: string | null;
  check_error: string | null;
};

/**
 * その組織の接続設定を1件だけ読む。設定が無ければ null。
 *
 * 読めなかったときは null ではなく throw する。
 * 「設定が無い」と「読めなかった」を同じ扱いにすると、障害のときに
 * 「まだ設定していません」と案内してしまう（CLAUDE.md「エラーは握りつぶさない」）。
 */
export async function loadSalesAiConnection(orgId: string): Promise<SalesAiConnection | null> {
  const admin = createServiceClient();
  const { data, error } = await admin
    .from("sales_ai_connections")
    .select("base_url, api_key, trade_map, checked_at, check_error")
    .eq("org_id", orgId)
    .maybeSingle<Row>();

  if (error) throw new Error(`営業AIの接続設定を読めませんでした（org=${orgId}）：${error.message}`);
  if (!data) return null;

  return {
    baseUrl: data.base_url,
    apiKey: data.api_key,
    tradeMap: data.trade_map ?? {},
    checkedAt: data.checked_at,
    checkError: data.check_error,
  };
}
