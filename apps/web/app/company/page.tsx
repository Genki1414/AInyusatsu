// 自社情報。協力会社へ送るメールと画面のヘッダーに使う自社の情報を設定する。
// あわせて営業AI（協力会社の開拓）の接続設定・郵送名義を置く。
import { formatTradeMap, maskApiKey, type TradeMap } from "@ai-nyusatsu-bu/domain";
import { AppShell } from "@/components/AppShell";
import { requireOrgContext } from "@/lib/auth";
import { CompanyForm } from "./company-form";
import { MailingIdentityForm, type MailingIdentityView } from "./mailing-identity-form";
import { SalesAiForm, type SalesAiView } from "./sales-ai-form";
import { UserForm } from "./user-form";

type SalesAiRow = {
  base_url: string;
  api_key: string;
  trade_map: TradeMap;
  checked_at: string | null;
  check_error: string | null;
};

type MailingIdentityRow = {
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

function jst(at: string | null): string | null {
  if (at === null) return null;
  const parsed = new Date(at);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
}

export default async function CompanyPage() {
  const { supabase, orgId, orgName, userName, userEmail } = await requireOrgContext();

  const [{ data: org }, { data: salesAi, error: salesAiError }, { data: mailingIdentity }] = await Promise.all([
    supabase
      .from("organizations")
      .select("overhead_rate, profit_rate, reply_to")
      .eq("id", orgId)
      .maybeSingle<{ overhead_rate: number; profit_rate: number; reply_to: string | null }>(),
    supabase
      .from("sales_ai_connections")
      .select("base_url, api_key, trade_map, checked_at, check_error")
      .eq("org_id", orgId)
      .maybeSingle<SalesAiRow>(),
    supabase
      .from("organization_mailing_identity")
      .select(
        "last_name, first_name, last_name_kana, first_name_kana, postal_code, prefecture, city, block, building, phone, department, position",
      )
      .eq("org_id", orgId)
      .maybeSingle<MailingIdentityRow>(),
  ]);
  if (salesAiError) {
    // 読めなくても他の設定は使える。握りつぶさずログには残す
    console.error(`[company] 営業AIの設定を読めませんでした（org=${orgId}）: ${salesAiError.message}`);
  }

  const tradeMap = salesAi?.trade_map ?? {};
  const salesAiView: SalesAiView = {
    baseUrl: salesAi?.base_url ?? "",
    // APIキーは実物を画面へ渡さない
    maskedApiKey: maskApiKey(salesAi?.api_key ?? null),
    hasKey: Boolean(salesAi?.api_key),
    tradeMapText: formatTradeMap(tradeMap),
    tradeCount: Object.keys(tradeMap).length,
    checkedAtLabel: jst(salesAi?.checked_at ?? null),
    checkError: salesAi?.check_error ?? null,
  };
  const mailingIdentityView: MailingIdentityView = {
    lastName: mailingIdentity?.last_name ?? "",
    firstName: mailingIdentity?.first_name ?? "",
    lastNameKana: mailingIdentity?.last_name_kana ?? "",
    firstNameKana: mailingIdentity?.first_name_kana ?? "",
    postalCode: mailingIdentity?.postal_code ?? "",
    prefecture: mailingIdentity?.prefecture ?? "",
    city: mailingIdentity?.city ?? "",
    block: mailingIdentity?.block ?? "",
    building: mailingIdentity?.building ?? "",
    phone: mailingIdentity?.phone ?? "",
    department: mailingIdentity?.department ?? "",
    position: mailingIdentity?.position ?? "",
  };

  return (
    <AppShell active="company" orgName={orgName}>
      <CompanyForm
        orgName={orgName}
        overheadRate={org?.overhead_rate ?? 0.12}
        profitRate={org?.profit_rate ?? 0.1}
        replyTo={org?.reply_to ?? ""}
        ownerEmail={userEmail}
      />
      <UserForm userName={userName} userEmail={userEmail} />
      <SalesAiForm view={salesAiView} />
      <MailingIdentityForm view={mailingIdentityView} />
    </AppShell>
  );
}
