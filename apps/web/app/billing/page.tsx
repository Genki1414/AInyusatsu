// ご契約（タスク4-7 → 請求書払いのみに変更）。
//
// 【何を見せるか】
// 支払いは請求書払いのみ（ユーザー決定 2026-08-25）。顧客が画面から
// 申し込む・支払い方法を変える・解約する、という操作は無い。
// いま使える状態かどうかと、問い合わせ先だけを出す。
//
// 【なぜ subscriptions を読まないか】
// 実際に使えるかどうかを決めているのは org_access ひとつだけ。
// subscriptions（Stripeのwebhookが書く表）はいま何も止めていない。
// 2つを並べて見せると、どちらが本当か分からなくなる。
// Stripe のコードは残してあるが動いていない（packages/billing）。

import { isActive, suspendedMessage } from "@ai-nyusatsu-bu/domain";
import { AppShell } from "@/components/AppShell";
import { requireOrgContext } from "@/lib/auth";
import { AccountRequestForm, type AccountRequestView } from "./account-request-form";
import { BillingForm, type BillingView } from "./billing-form";

type AccessRow = { status: string; suspended_reason: string | null; activated_at: string | null };
type LoginRow = { name: string; email: string; role: string };
type RequestRow = { id: string; name: string; email: string; created_at: string };

function jstDay(at: string | null): string | null {
  if (at === null) return null;
  const parsed = new Date(at);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" });
}

export default async function BillingPage() {
  const { supabase, orgId, orgName, userName } = await requireOrgContext();

  // ログインの一覧と依頼中のものも同時に引く。順番に待つ理由が無い
  const [{ data, error }, logins, requests] = await Promise.all([
    supabase
      .from("org_access")
      .select("status, suspended_reason, activated_at")
      .eq("org_id", orgId)
      .maybeSingle<AccessRow>(),
    supabase
      .from("users")
      .select("name, email, role")
      .eq("org_id", orgId)
      .order("created_at", { ascending: true })
      .returns<LoginRow[]>(),
    supabase
      .from("account_requests")
      .select("id, name, email, created_at")
      .eq("org_id", orgId)
      .eq("status", "依頼中")
      .order("created_at", { ascending: true })
      .returns<RequestRow[]>(),
  ]);
  if (error) {
    // 読めなくても画面は出す。握りつぶさずログには残す
    console.error(`[billing] 利用状態の取得に失敗しました（org=${orgId}）: ${error.message}`);
  }
  if (logins.error) console.error(`[billing] ログインの一覧を読めませんでした（org=${orgId}）: ${logins.error.message}`);
  if (requests.error) console.error(`[billing] 追加の依頼を読めませんでした（org=${orgId}）: ${requests.error.message}`);

  const accountView: AccountRequestView = {
    logins: (logins.data ?? []).map((row) => ({
      name: row.name,
      email: row.email,
      isOwner: row.role === "owner",
    })),
    pending: (requests.data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      createdOn: jstDay(row.created_at) ?? "—",
    })),
  };

  // ここを開けている時点で requireOrgContext を通っている＝利用中。
  // それでも状態は読んだ値のまま出す（画面と実際がずれていたら気づけるように）
  const active = isActive(data?.status);
  const view: BillingView = {
    active,
    statusMessage: active
      ? "ご利用いただけます。"
      : suspendedMessage(data?.suspended_reason ?? null),
    startedOn: jstDay(data?.activated_at ?? null),
    // 未設定なら住所を出さない（作り話の連絡先を見せない）
    supportEmail: process.env.SUPPORT_EMAIL ?? null,
  };

  return (
    <AppShell active="billing" orgName={orgName} userName={userName}>
      <BillingForm view={view} />
      {/* 料金が増える操作なので、ここで作れるのは依頼まで。発行は本部 */}
      <AccountRequestForm view={accountView} />
    </AppShell>
  );
}
