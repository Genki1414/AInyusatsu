"use server";

// 本部が組織ごとに営業AI（eigyouAI）の接続を設定する（9月分：協力会社開拓）。
//
// 【なぜ本部側にあるか】
// 営業AIのテナントは本部が作り、APIキーも本部が受け取る。顧客は営業AIの画面を
// 開かない（ユーザー決定 2026-08-28 / docs/reference/営業AI連携_設計.md）。
// 顧客側に入力欄を置くと、本部がキーを顧客に教えて貼ってもらうことになる。
//
// 【送信はしない】
// ここでするのは保存と疎通確認だけ。フォームへ送るのは、案件画面で利用者が
// ボタンを押したときの1回きり（CLAUDE.md「やらないこと：問い合わせフォームへの
// 無人の自動送信」）。

import { revalidatePath } from "next/cache";
import { OutreachError, previewTargets } from "@ai-nyusatsu-bu/outreach";
import { validateSalesAiSettings } from "@ai-nyusatsu-bu/domain";
import { requireAdmin } from "@/lib/admin";
import { loadSalesAiConnection } from "@/lib/sales-ai";

export type SalesAiAdminState = {
  error: string | null;
  message: string | null;
  /** どの組織の操作だったか。1画面に複数組織が並ぶので、結果を出す行を間違えないため */
  orgId: string | null;
};

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function fail(orgId: string | null, error: string): SalesAiAdminState {
  return { error, message: null, orgId };
}

/** 設定を保存する。疎通確認はしない（キーだけ先に入れておける）。 */
export async function saveSalesAiConnection(
  _prev: SalesAiAdminState,
  formData: FormData,
): Promise<SalesAiAdminState> {
  const { admin } = await requireAdmin();
  const orgId = text(formData, "org_id").trim();
  if (orgId === "") return fail(null, "組織が指定されていません");

  const validated = validateSalesAiSettings({
    baseUrl: text(formData, "base_url"),
    apiKey: text(formData, "api_key"),
    tradeMapText: text(formData, "trade_map"),
  });
  if (!validated.ok) return fail(orgId, validated.error);

  const { error } = await admin.from("sales_ai_connections").upsert({
    org_id: orgId,
    base_url: validated.value.baseUrl,
    api_key: validated.value.apiKey,
    trade_map: validated.value.tradeMap,
    // 設定を変えたら、前の確認結果は当てにならない
    checked_at: null,
    check_error: null,
    updated_at: new Date().toISOString(),
  });
  if (error) return fail(orgId, `保存できませんでした：${error.message}`);

  revalidatePath("/admin/accounts");
  return {
    error: null,
    message: `保存しました。業種の対応：${Object.keys(validated.value.tradeMap).length}件`,
    orgId,
  };
}

/**
 * つながるかを確かめる。
 *
 * 件数を見るだけの呼び出し（preview）を1回だけ投げる。リストは作らないし送信もしない。
 * 業種が1件も対応していないと preview は投げられない（業種の条件が消えて、
 * その県の全社が対象になってしまうため）。
 */
export async function checkSalesAiConnection(
  _prev: SalesAiAdminState,
  formData: FormData,
): Promise<SalesAiAdminState> {
  const { admin } = await requireAdmin();
  const orgId = text(formData, "org_id").trim();
  if (orgId === "") return fail(null, "組織が指定されていません");

  const connection = await loadSalesAiConnection(orgId);
  if (!connection) return fail(orgId, "先に保存してください。");

  const codes = Object.values(connection.tradeMap).filter(
    (code) => typeof code === "string" && code.trim() !== "",
  );
  if (codes.length === 0) {
    return fail(
      orgId,
      "業種の対応表が空です。1件でも入れてから確認してください（業種を指定せずに問い合わせると、その県の全社が対象になってしまうため）。",
    );
  }

  const now = new Date().toISOString();
  try {
    // 都道府県は絞らず、業種1つだけで件数を見る。どこか1件でも返れば疎通は取れている
    const preview = await previewTargets(
      { baseUrl: connection.baseUrl, apiKey: connection.apiKey },
      { prefs: [], trades: [codes[0]] },
    );
    await admin
      .from("sales_ai_connections")
      .update({ checked_at: now, check_error: null, updated_at: now })
      .eq("org_id", orgId);
    revalidatePath("/admin/accounts");
    return {
      error: null,
      message: `つながりました。「${codes[0]}」の登録企業は${preview.count}社です。`,
      orgId,
    };
  } catch (err) {
    const reason = err instanceof OutreachError ? `${err.code}：${err.message}` : String(err);
    // 失敗の理由を残す。次に開いたときに何が起きたか分かるように
    await admin
      .from("sales_ai_connections")
      .update({ checked_at: now, check_error: reason, updated_at: now })
      .eq("org_id", orgId);
    revalidatePath("/admin/accounts");
    return fail(orgId, `つながりませんでした（${reason}）`);
  }
}
