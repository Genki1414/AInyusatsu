// 営業AI（eigyouAI）の送信元テンプレートへの自動同期（T55の続き）。
//
// 【なぜ自動か】
// 最初は本部が /admin/sales-ai で契約者ごとに手入力していたが、手間が多すぎるという
// ユーザー決定（2026-08-28その2）。顧客が自分の会社情報（organizations.name /
// reply_to、organization_mailing_identity）を /company で入力・変更するたびに、
// ここを通して営業AI側の送信元テンプレートへそのまま反映する。
//
// 【どこから呼ぶか】
// - apps/web/app/company/actions.ts（顧客が自社情報・郵送名義を保存したとき）
// - apps/web/app/admin/sales-ai/actions.ts（本部がテナントを作った直後、および
//   「今すぐ同期する」ボタン）
//
// 【必ず service_role で呼ぶ】
// sales_ai_connections.api_key は authenticated から列の読み取り権限を外してある
// （supabase/migrations/20260828000002_sales_ai_connections_admin.sql。営業AIの
// APIキーを顧客のRLSの範囲で読めるままにすると、直に営業AIのAPIを叩けてしまい、
// 「件数を見てから送る」「対応表に無い業種では送らない」という歯止めが外れるため）。
// 顧客自身のセッションのクライアントを渡すとapi_keyが読めず必ず失敗するので、
// 呼び出し側は createServiceClient()（@ai-nyusatsu-bu/db）を渡すこと。
//
// 【送信元は契約者本人の名義】
// 会社名・送信元メールは organizations.name / reply_to（無ければオーナーのメール）を
// そのまま使う。AI入札部自身のアドレスにはしない（ユーザー決定 2026-08-28）。
//
// 【同期の失敗は保存を止めない】
// 営業AI側が一時的に落ちていても、自社情報の保存自体は失敗させない。
// 呼び出し側で結果を見て、必要なら画面にひとこと添える。

import type { SupabaseClient } from "@supabase/supabase-js";
import { setSenderIdentity, OutreachError, type SalesAiOpsConnection } from "@ai-nyusatsu-bu/outreach";
import { combineAddress, type MailingIdentityInput } from "@ai-nyusatsu-bu/domain";

export type SyncResult = { ok: true } | { ok: false; reason: string };

/**
 * 本部専用の運用キーでの接続。未設定なら null（呼び出し側で「設定してください」と出す）。
 * /admin/sales-ai（テナント作成・送信元同期）と /admin/accounts（Kill Switch連動）の
 * 両方が使う、営業AI側の運用APIへの唯一の入り口。
 */
export function opsConnection(): SalesAiOpsConnection | null {
  const opsApiKey = process.env.SALES_ENGINE_API_KEY;
  if (!opsApiKey) return null;
  const baseUrl = (process.env.EIGYOU_AI_BASE_URL || "https://ashibase.jp").trim();
  return { baseUrl, opsApiKey };
}

type OrgRow = { name: string; reply_to: string | null };
type IdentityRow = {
  last_name: string | null;
  first_name: string | null;
  last_name_kana: string | null;
  first_name_kana: string | null;
  postal_code: string | null;
  prefecture: string | null;
  city: string | null;
  block: string | null;
  building: string | null;
  phone: string | null;
  department: string | null;
  position: string | null;
};
type ConnectionRow = { base_url: string; api_key: string; tenant_id: number | null };

function orNull(value: string | null | undefined): string | undefined {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * 自社情報を営業AIの送信元テンプレートへ同期する。
 * テナントがまだ無い（sales_ai_connectionsに行が無い）組織では何もせず ok:false を返す
 * （エラーではなく「まだ対象外」という扱い。呼び出し側は静かに無視してよい）。
 */
export async function syncSalesAiSenderIdentity(
  supabase: SupabaseClient,
  orgId: string,
): Promise<SyncResult> {
  const [{ data: org, error: orgError }, { data: identity }, { data: connection }] = await Promise.all([
    supabase.from("organizations").select("name, reply_to").eq("id", orgId).maybeSingle<OrgRow>(),
    supabase.from("organization_mailing_identity").select(
      "last_name, first_name, last_name_kana, first_name_kana, postal_code, prefecture, city, block, building, phone, department, position",
    ).eq("org_id", orgId).maybeSingle<IdentityRow>(),
    supabase.from("sales_ai_connections").select("base_url, api_key, tenant_id").eq("org_id", orgId).maybeSingle<ConnectionRow>(),
  ]);

  if (!connection?.tenant_id || !connection.api_key) {
    return { ok: false, reason: "営業AIのテナントがまだありません（/admin/sales-aiで作成してください）" };
  }
  if (orgError || !org) {
    return { ok: false, reason: `組織情報が読めませんでした（${orgError?.message ?? "not found"}）` };
  }

  let senderEmail = org.reply_to;
  if (!senderEmail) {
    const { data: owner } = await supabase
      .from("users")
      .select("email")
      .eq("org_id", orgId)
      .eq("role", "owner")
      .maybeSingle<{ email: string }>();
    senderEmail = owner?.email ?? null;
  }
  if (!senderEmail) {
    return { ok: false, reason: "送信元メールアドレスがありません（会社情報で返信先を設定してください）" };
  }

  const mailing: MailingIdentityInput = {
    lastName: identity?.last_name ?? undefined,
    firstName: identity?.first_name ?? undefined,
    lastNameKana: identity?.last_name_kana ?? undefined,
    firstNameKana: identity?.first_name_kana ?? undefined,
    postalCode: identity?.postal_code ?? undefined,
    prefecture: identity?.prefecture ?? undefined,
    city: identity?.city ?? undefined,
    block: identity?.block ?? undefined,
    building: identity?.building ?? undefined,
    phone: identity?.phone ?? undefined,
    department: identity?.department ?? undefined,
    position: identity?.position ?? undefined,
  };

  try {
    await setSenderIdentity(
      { baseUrl: connection.base_url, apiKey: connection.api_key },
      {
        templateName: "AI入札部（自動同期）",
        senderName: org.name,
        senderEmail,
        senderAddress: combineAddress(mailing),
        lastName: orNull(mailing.lastName),
        firstName: orNull(mailing.firstName),
        lastNameKana: orNull(mailing.lastNameKana),
        firstNameKana: orNull(mailing.firstNameKana),
        postalCode: orNull(mailing.postalCode),
        prefecture: orNull(mailing.prefecture),
        city: orNull(mailing.city),
        block: orNull(mailing.block),
        building: orNull(mailing.building),
        phone: orNull(mailing.phone),
        department: orNull(mailing.department),
        position: orNull(mailing.position),
      },
    );
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err instanceof OutreachError ? `${err.code}：${err.message}` : String(err) };
  }
}
