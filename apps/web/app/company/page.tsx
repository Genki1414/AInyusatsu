// 自社情報。協力会社へ送るメールと画面のヘッダーに使う自社の情報を設定する。
import { AppShell } from "@/components/AppShell";
import { requireOrgContext } from "@/lib/auth";
import { CompanyForm } from "./company-form";

export default async function CompanyPage() {
  const { supabase, orgId, orgName } = await requireOrgContext();

  const { data: org } = await supabase
    .from("organizations")
    .select("overhead_rate, profit_rate")
    .eq("id", orgId)
    .maybeSingle<{ overhead_rate: number; profit_rate: number }>();

  return (
    <AppShell active="company" orgName={orgName}>
      <CompanyForm orgName={orgName} overheadRate={org?.overhead_rate ?? 0.12} profitRate={org?.profit_rate ?? 0.1} />
    </AppShell>
  );
}
