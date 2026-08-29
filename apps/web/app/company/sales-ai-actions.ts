"use server";

// 営業AI（eigyouAI）の接続設定（9月分：協力会社開拓）。
//
// 【何をするか】
// 接続情報の保存と、疎通確認。候補の検索とリスト作成は案件画面から行う。
//
// 【送信はしない】
// フォームへの送信は営業AI側の画面から人が実行する
// （CLAUDE.md「やらないこと：問い合わせフォームへの自動送信」）。
// ここにも案件画面にも、送信を呼ぶ処理は書かない。

import { revalidatePath } from "next/cache";
import { listTrades, OutreachError, previewTargets, type TradeEntry } from "@ai-nyusatsu-bu/outreach";
import { validateSalesAiSettings, type TradeMap } from "@ai-nyusatsu-bu/domain";
import { requireOrgContext } from "@/lib/auth";

export type SalesAiState = { error: string | null; message: string | null };
export type TradesState = { error: string | null; trades: TradeEntry[] | null };

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

/** 設定を保存する。疎通確認はしない（キーだけ先に入れておける）。 */
export async function saveSalesAiSettings(_prev: SalesAiState, formData: FormData): Promise<SalesAiState> {
  const validated = validateSalesAiSettings({
    baseUrl: text(formData, "base_url"),
    apiKey: text(formData, "api_key"),
    tradeMapText: text(formData, "trade_map"),
  });
  if (!validated.ok) return { error: validated.error, message: null };

  const { supabase, orgId } = await requireOrgContext();
  const { error } = await supabase.from("sales_ai_connections").upsert({
    org_id: orgId,
    base_url: validated.value.baseUrl,
    api_key: validated.value.apiKey,
    trade_map: validated.value.tradeMap,
    // 設定を変えたら、前の確認結果は当てにならない
    checked_at: null,
    check_error: null,
    updated_at: new Date().toISOString(),
  });
  if (error) return { error: `保存できませんでした：${error.message}`, message: null };

  revalidatePath("/company");
  return {
    error: null,
    message: `保存しました。業種の対応：${Object.keys(validated.value.tradeMap).length}件`,
  };
}

/**
 * つながるかを確かめる。
 *
 * 件数を見るだけの呼び出し（preview）を1回だけ投げる。リストは作らないし送信もしない。
 * 業種が1件も対応していないと preview は投げられない（その県の全社が対象になるため）。
 */
export async function checkSalesAiConnection(_prev: SalesAiState, _formData: FormData): Promise<SalesAiState> {
  const { supabase, orgId } = await requireOrgContext();

  const { data } = await supabase
    .from("sales_ai_connections")
    .select("base_url, api_key, trade_map")
    .eq("org_id", orgId)
    .maybeSingle<{ base_url: string; api_key: string; trade_map: TradeMap }>();
  if (!data) return { error: "先に保存してください。", message: null };

  const codes = Object.values(data.trade_map ?? {}).filter((code) => typeof code === "string" && code.trim() !== "");
  if (codes.length === 0) {
    return {
      error: "業種の対応表が空です。1件でも入れてから確認してください（業種を指定せずに問い合わせると、その県の全社が対象になってしまうため）。",
      message: null,
    };
  }

  const now = new Date().toISOString();
  try {
    // 都道府県は絞らず、業種1つだけで件数を見る。どこか1件でも返れば疎通は取れている
    const preview = await previewTargets(
      { baseUrl: data.base_url, apiKey: data.api_key },
      { prefs: [], trades: [codes[0]] },
    );
    await supabase
      .from("sales_ai_connections")
      .update({ checked_at: now, check_error: null, updated_at: now })
      .eq("org_id", orgId);
    revalidatePath("/company");
    return { error: null, message: `つながりました。「${codes[0]}」の登録企業は${preview.count}社です。` };
  } catch (err) {
    const reason = err instanceof OutreachError ? `${err.code}：${err.message}` : String(err);
    // 失敗の理由を残す。次に開いたときに何が起きたか分かるように
    await supabase
      .from("sales_ai_connections")
      .update({ checked_at: now, check_error: reason, updated_at: now })
      .eq("org_id", orgId);
    revalidatePath("/company");
    return { error: `つながりませんでした（${reason}）`, message: null };
  }
}

/**
 * 営業AI側が対応している業種のコードを見る（T56）。
 *
 * 対応表（trade_map）に書くコードを当てずっぽうで入力せずに済むように、
 * 営業AI側の実際の語彙を取得して画面に出す。対応表への反映は引き続き手で行う
 * （このアクションは表示するだけで、trade_mapは書き換えない）。
 */
export async function fetchSalesAiTrades(_prev: TradesState, _formData: FormData): Promise<TradesState> {
  const { supabase, orgId } = await requireOrgContext();

  const { data } = await supabase
    .from("sales_ai_connections")
    .select("base_url, api_key")
    .eq("org_id", orgId)
    .maybeSingle<{ base_url: string; api_key: string }>();
  if (!data) return { error: "先に保存してください。", trades: null };

  try {
    const trades = await listTrades({ baseUrl: data.base_url, apiKey: data.api_key });
    return { error: null, trades };
  } catch (err) {
    const reason = err instanceof OutreachError ? `${err.code}：${err.message}` : String(err);
    return { error: `業種コードを取得できませんでした（${reason}）`, trades: null };
  }
}
