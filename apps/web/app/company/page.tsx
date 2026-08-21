// 自社情報。協力会社へ送るメールと画面のヘッダーに使う自社の情報を設定する。
import { AppShell } from "@/components/AppShell";
import { requireOrgContext } from "@/lib/auth";
import { CompanyForm } from "./company-form";

export default async function CompanyPage() {
  const { orgName } = await requireOrgContext();

  return (
    <AppShell active="company" orgName={orgName}>
      <CompanyForm orgName={orgName} />
    </AppShell>
  );
}
