"use server";

// 本部側の営業AI（eigyouAI）接続設定（T55の続き）。
//
// 【なぜ本部の画面が要るか】
// 「顧客は営業AIの画面を開かない」（ユーザー決定 2026-08-28）。本部が営業AIの
// テナントを作り、APIキーを顧客に見せずそのまま保存する。顧客向けの画面
// （apps/web/app/company/sales-ai-actions.ts）はまだ残っているが、本来はここへ移す。
//
// 【送信元は契約者本人の名義にする。手入力ではなく自動同期】
// AI入札部の契約者が協力会社開拓のフォームを送信するとき、フォームに載る送信元は
// AI入札部自身のアドレスではなく契約者本人の名義にする（ユーザー決定 2026-08-28）。
// 最初は本部がここで毎回手入力していたが、手間が多すぎるというユーザー決定
// （2026-08-28その2）。顧客が /company で自社情報・郵送名義を入力すれば
// apps/web/lib/sales_ai_sync.ts が自動で反映する。ここではテナント作成直後の
// 初回同期と、うまくいかなかったときの「今すぐ同期する」だけを行う。
//
// 【service_role でしか行えない】
// 組織をまたいで sales_ai_connections を読み書きするため、requireAdmin が運営で
// あることを確かめたうえで渡すクライアントを使う。この関数を通さずに service_role を
// 使わないこと。
//
// 【送信はしない】
// フォームへの送信は営業AI側の画面から人が実行する
// （CLAUDE.md「やらないこと：問い合わせフォームへの自動送信」）。ここにも送信を呼ぶ処理は書かない。

import { revalidatePath } from "next/cache";
import { createTenant, listTrades, OutreachError, previewTargets, type TradeEntry } from "@ai-nyusatsu-bu/outreach";
import {
  basePlanQuota,
  validateProvisionTenant,
  validateSalesAiSettings,
  type TradeMap,
} from "@ai-nyusatsu-bu/domain";
import { requireAdmin } from "@/lib/admin";
import { opsConnection, syncSalesAiSenderIdentity } from "@/lib/sales_ai_sync";

export type SalesAiAdminState = { error: string | null; message: string | null };
const EMPTY: SalesAiAdminState = { error: null, message: null };

export type TradesState = { error: string | null; trades: TradeEntry[] | null };

function fail(error: string): SalesAiAdminState {
  return { ...EMPTY, error };
}

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function describe(err: unknown): string {
  return err instanceof OutreachError ? `${err.code}：${err.message}` : String(err);
}

type ConnectionRow = {
  org_id: string;
  base_url: string;
  api_key: string;
  tenant_id: number | null;
  trade_map: TradeMap;
};

async function loadConnection(
  admin: Awaited<ReturnType<typeof requireAdmin>>["admin"],
  orgId: string,
): Promise<ConnectionRow | null> {
  const { data } = await admin
    .from("sales_ai_connections")
    .select("org_id, base_url, api_key, tenant_id, trade_map")
    .eq("org_id", orgId)
    .maybeSingle<ConnectionRow>();
  return data ?? null;
}

/**
 * 営業AIに新しいテナントを作り、そのまま保存する。
 *
 * 【二重作成を防ぐ】
 * 既にtenant_idが入っていれば止める。作り直したいときは先に接続を削除する運用にする
 * （営業AI側にテナントが残ったままになるが、api_keyを差し替えれば実害は無い）。
 */
export async function provisionTenant(
  _prevState: SalesAiAdminState,
  formData: FormData,
): Promise<SalesAiAdminState> {
  const { admin } = await requireAdmin();

  const orgId = text(formData, "org_id");
  if (orgId === "") return fail("組織が指定されていません");

  const validated = validateProvisionTenant({
    orgName: text(formData, "org_name"),
    senderEmail: text(formData, "sender_email"),
  });
  if (!validated.ok) return fail(validated.error);

  const conn = opsConnection();
  if (!conn) {
    return fail(
      "SALES_ENGINE_API_KEYが設定されていません。営業AI側のSALES_ENGINE_API_KEYと同じ値を、" +
        "この環境変数に設定してから再デプロイしてください",
    );
  }

  const existing = await loadConnection(admin, orgId);
  if (existing?.tenant_id) {
    return fail(
      `このアカウントには既に営業AIのテナント（ID:${existing.tenant_id}）があります。` +
        "作り直すには、先に下の「接続を削除する」から今の接続を消してください",
    );
  }

  let created;
  try {
    // 送信枠は必ず渡す。渡さないと営業AI側の既定値（月4,000通）になり、
    // 契約の500通に対して8倍送れる状態になる（packages/domain/src/sales_ai.ts）
    const quota = basePlanQuota();
    created = await createTenant(conn, {
      name: validated.value.orgName,
      senderEmail: validated.value.senderEmail,
      monthlySendQuota: quota.monthlySends,
      dailySendQuota: quota.dailySends,
    });
  } catch (err) {
    return fail(`テナントを作れませんでした（${describe(err)}）`);
  }

  const now = new Date().toISOString();
  const { error } = await admin.from("sales_ai_connections").upsert({
    org_id: orgId,
    base_url: conn.baseUrl,
    api_key: created.apiKey,
    tenant_id: created.tenantId,
    trade_map: existing?.trade_map ?? {},
    checked_at: null,
    check_error: null,
    updated_at: now,
  });
  if (error) {
    // 営業AI側にはテナントができたが、こちらに記録が残らなかった状態。
    // 有効化前なので実害は無いが、原因を隠さない（CLAUDE.md）
    return fail(
      `営業AIにテナント（ID:${created.tenantId}）は作成できましたが、保存できませんでした（${error.message}）。` +
        "下の「接続を手で設定する」から、このテナントIDとAPIキーを控えて登録し直してください" +
        "（APIキーは営業AI側の画面からは二度と見られません）",
    );
  }

  // 顧客が/companyで既に自社情報・郵送名義を入れていれば、作成直後にそのまま反映する。
  // まだ何も入れていない組織では「送信元メールアドレスがありません」等で失敗するが、
  // それ自体はエラーではない（あとで顧客が/companyを保存したときに自動で同期される）
  const sync = await syncSalesAiSenderIdentity(admin, orgId);

  revalidatePath("/admin/sales-ai");
  return {
    error: null,
    message:
      `テナント（ID:${created.tenantId}）を作成しました。` +
      (sync.ok
        ? "送信元（顧客名義）も自動で反映しました。"
        : `送信元はまだ反映されていません（${sync.reason}）。顧客が「自社情報」を保存すると自動で反映されます`),
  };
}

/** 接続を手で設定・上書きする（既に営業AI側で発行済みのキーを持っているとき等）。 */
export async function saveConnection(_prevState: SalesAiAdminState, formData: FormData): Promise<SalesAiAdminState> {
  const { admin } = await requireAdmin();

  const orgId = text(formData, "org_id");
  if (orgId === "") return fail("組織が指定されていません");

  const validated = validateSalesAiSettings({
    baseUrl: text(formData, "base_url"),
    apiKey: text(formData, "api_key"),
    tradeMapText: text(formData, "trade_map"),
  });
  if (!validated.ok) return fail(validated.error);

  const tenantIdRaw = text(formData, "tenant_id").trim();
  const tenantId = tenantIdRaw === "" ? null : Number(tenantIdRaw);
  if (tenantIdRaw !== "" && (!Number.isInteger(tenantId) || (tenantId as number) <= 0)) {
    return fail("テナントIDは正の整数で入力してください（分からなければ空欄のままでよい）");
  }

  const now = new Date().toISOString();
  const { error } = await admin.from("sales_ai_connections").upsert({
    org_id: orgId,
    base_url: validated.value.baseUrl,
    api_key: validated.value.apiKey,
    tenant_id: tenantId,
    trade_map: validated.value.tradeMap,
    checked_at: null,
    check_error: null,
    updated_at: now,
  });
  if (error) return fail(`保存できませんでした：${error.message}`);

  revalidatePath("/admin/sales-ai");
  return { error: null, message: `保存しました。業種の対応：${Object.keys(validated.value.tradeMap).length}件` };
}

/** 接続を削除する（作り直すときの前段）。営業AI側のテナントは削除しない（残っても実害は無い）。 */
export async function deleteConnection(_prevState: SalesAiAdminState, formData: FormData): Promise<SalesAiAdminState> {
  const { admin } = await requireAdmin();
  const orgId = text(formData, "org_id");
  if (orgId === "") return fail("組織が指定されていません");

  const { error } = await admin.from("sales_ai_connections").delete().eq("org_id", orgId);
  if (error) return fail(`削除できませんでした：${error.message}`);

  revalidatePath("/admin/sales-ai");
  return { error: null, message: "接続を削除しました" };
}

/** つながるかを確かめる（company/sales-ai-actions.ts の本部版）。 */
export async function checkConnection(_prevState: SalesAiAdminState, formData: FormData): Promise<SalesAiAdminState> {
  const { admin } = await requireAdmin();
  const orgId = text(formData, "org_id");
  if (orgId === "") return fail("組織が指定されていません");

  const data = await loadConnection(admin, orgId);
  if (!data) return fail("先に接続を設定してください");

  const codes = Object.values(data.trade_map ?? {}).filter((code) => typeof code === "string" && code.trim() !== "");
  if (codes.length === 0) {
    return fail(
      "業種の対応表が空です。1件でも入れてから確認してください" +
        "（業種を指定せずに問い合わせると、その都道府県の全社が対象になってしまうため）。",
    );
  }

  const now = new Date().toISOString();
  try {
    const preview = await previewTargets({ baseUrl: data.base_url, apiKey: data.api_key }, { prefs: [], trades: [codes[0]] });
    await admin.from("sales_ai_connections").update({ checked_at: now, check_error: null, updated_at: now }).eq("org_id", orgId);
    revalidatePath("/admin/sales-ai");
    return { error: null, message: `つながりました。「${codes[0]}」の登録企業は${preview.count}社です。` };
  } catch (err) {
    const reason = describe(err);
    await admin.from("sales_ai_connections").update({ checked_at: now, check_error: reason, updated_at: now }).eq("org_id", orgId);
    revalidatePath("/admin/sales-ai");
    return { error: `つながりませんでした（${reason}）`, message: null };
  }
}

/**
 * 営業AI側が対応している業種のコードを見る（T56）。
 *
 * 「業種の対応表（trade_map）」を手で書くとき、営業AI側の実際のコードを
 * 当てずっぽうで書かずに済むようにするための一覧表示。対応表自体はここでは書き換えない
 * （引き続き「接続を手で編集する」のテキストエリアに手で書き写す）。
 */
export async function fetchTrades(_prevState: TradesState, formData: FormData): Promise<TradesState> {
  const { admin } = await requireAdmin();
  const orgId = text(formData, "org_id");
  if (orgId === "") return { error: "組織が指定されていません", trades: null };

  const data = await loadConnection(admin, orgId);
  if (!data) return { error: "先に接続を設定してください", trades: null };

  try {
    const trades = await listTrades({ baseUrl: data.base_url, apiKey: data.api_key });
    return { error: null, trades };
  } catch (err) {
    return { error: `業種コードを取得できませんでした（${describe(err)}）`, trades: null };
  }
}

/**
 * 送信元（顧客名義）を今すぐ同期する。
 *
 * 通常は顧客が /company を保存するたびに自動で同期される（apps/web/lib/sales_ai_sync.ts）。
 * このボタンは、その自動同期がうまくいかなかったとき（営業AI側が一時的に落ちていた等）に
 * 手で再試行するためのもの。入力欄は無い＝本部が値を打ち直すことはしない。
 */
export async function syncSenderIdentity(
  _prevState: SalesAiAdminState,
  formData: FormData,
): Promise<SalesAiAdminState> {
  const { admin } = await requireAdmin();
  const orgId = text(formData, "org_id");
  if (orgId === "") return fail("組織が指定されていません");

  const sync = await syncSalesAiSenderIdentity(admin, orgId);
  if (!sync.ok) return fail(`同期できませんでした（${sync.reason}）`);

  revalidatePath("/admin/sales-ai");
  return { error: null, message: "送信元（顧客名義）を同期しました。" };
}
