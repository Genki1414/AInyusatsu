"use server";

// 本部側の営業AI（eigyouAI）接続設定（T55の続き）。
//
// 【なぜ本部の画面が要るか】
// 「顧客は営業AIの画面を開かない」（ユーザー決定 2026-08-28）。本部が営業AIの
// テナントを作り、APIキーを顧客に見せずそのまま保存する。顧客向けの画面
// （apps/web/app/company/sales-ai-actions.ts）はまだ残っているが、本来はここへ移す。
//
// 【送信元は契約者本人の名義にする】
// AI入札部の契約者が協力会社開拓のフォームを送信するとき、フォームに載る送信元は
// AI入札部自身のアドレスではなく契約者本人の名義にする（ユーザー決定 2026-08-28）。
// AI入札部が自社で見積依頼を送るときの送信元（packages/domain/src/sender_identity.ts）
// とは別物。
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
import {
  createTenant,
  OutreachError,
  previewTargets,
  setSenderIdentity,
  type SalesAiOpsConnection,
} from "@ai-nyusatsu-bu/outreach";
import {
  validateProvisionTenant,
  validateSalesAiSettings,
  validateSenderIdentity,
  type TradeMap,
} from "@ai-nyusatsu-bu/domain";
import { requireAdmin } from "@/lib/admin";

export type SalesAiAdminState = { error: string | null; message: string | null };
const EMPTY: SalesAiAdminState = { error: null, message: null };

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

/** 本部専用の運用キーでの接続。未設定なら null（作る側で「設定してください」と出す）。 */
function opsConnection(): SalesAiOpsConnection | null {
  const opsApiKey = process.env.SALES_ENGINE_API_KEY;
  if (!opsApiKey) return null;
  const baseUrl = (process.env.EIGYOU_AI_BASE_URL || "https://ashibase.jp").trim();
  return { baseUrl, opsApiKey };
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
    created = await createTenant(conn, { name: validated.value.orgName, senderEmail: validated.value.senderEmail });
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

  revalidatePath("/admin/sales-ai");
  return {
    error: null,
    message: `テナント（ID:${created.tenantId}）を作成しました。続けて下の「送信元（顧客名義）」を設定してください。`,
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
 * 送信元（顧客名義）を登録して有効化する。
 * 先にテナントが必要（api_keyが要るため）。
 */
export async function saveSenderIdentity(
  _prevState: SalesAiAdminState,
  formData: FormData,
): Promise<SalesAiAdminState> {
  const { admin } = await requireAdmin();

  const orgId = text(formData, "org_id");
  if (orgId === "") return fail("組織が指定されていません");

  const validated = validateSenderIdentity({
    templateName: text(formData, "template_name"),
    senderName: text(formData, "sender_name"),
    senderEmail: text(formData, "sender_email"),
    senderAddress: text(formData, "sender_address"),
    optoutUrl: text(formData, "optout_url"),
    lastName: text(formData, "last_name"),
    firstName: text(formData, "first_name"),
    lastNameKana: text(formData, "last_name_kana"),
    firstNameKana: text(formData, "first_name_kana"),
    postalCode: text(formData, "postal_code"),
    prefecture: text(formData, "prefecture"),
    city: text(formData, "city"),
    block: text(formData, "block"),
    building: text(formData, "building"),
    phone: text(formData, "phone"),
    department: text(formData, "department"),
    position: text(formData, "position"),
  });
  if (!validated.ok) return fail(validated.error);

  const data = await loadConnection(admin, orgId);
  if (!data) return fail("先に営業AIの接続（テナント）を設定してください");

  try {
    await setSenderIdentity({ baseUrl: data.base_url, apiKey: data.api_key }, validated.value);
  } catch (err) {
    return fail(`送信元を設定できませんでした（${describe(err)}）`);
  }

  revalidatePath("/admin/sales-ai");
  return { error: null, message: "送信元（顧客名義）を設定し、有効にしました。" };
}
