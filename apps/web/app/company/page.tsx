// 自社情報。協力会社へ送るメールと画面のヘッダーに使う自社の情報を設定する。
// あわせて営業AI（協力会社の開拓）が使える状態かを表示する。
//
// 【営業AIの設定はここに無い】
// 営業AIのテナントとAPIキーは本部が作る。顧客は営業AIの画面を開かない
// （ユーザー決定 2026-08-28 / docs/reference/営業AI連携_設計.md）。
// ここは「使えるかどうか」を見せるだけで、入力欄は置かない。
// 設定は本部の /admin/accounts から行う。
import { type TradeMap } from "@ai-nyusatsu-bu/domain";
import { AppShell } from "@/components/AppShell";
import { Panel } from "@/components/ui";
import { requireOrgContext } from "@/lib/auth";
import { CompanyForm } from "./company-form";
import { UserForm } from "./user-form";

type SalesAiRow = {
  base_url: string;
  trade_map: TradeMap;
};

/**
 * 営業AIが使えるかどうかだけを出す。
 * 案件画面でボタンが出ない理由が、ここを見れば分かるようにしておく。
 */
function SalesAiStatus({ trades }: { trades: string[] }) {
  return (
    <Panel title="営業AI連携（協力会社の開拓）">
      {trades.length === 0 ? (
        <p className="text-xs leading-relaxed text-slate-600">
          いまはご利用いただけません。ご希望の場合は本部までご連絡ください。
        </p>
      ) : (
        <p className="text-xs leading-relaxed text-slate-600">
          ご利用いただけます。案件の「見積依頼」タブで、依頼先がいない業種に
          「営業AIで候補を探して送る」が表示されます。
          <br />
          対応している業種：<span className="font-medium text-slate-800">{trades.join("・")}</span>
        </p>
      )}
      <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
        接続の設定は本部が行います。対応業種を増やしたいときは本部までご連絡ください。
        送信は、案件画面でボタンを押したときにだけ行われます。
      </p>
    </Panel>
  );
}

export default async function CompanyPage() {
  const { supabase, orgId, orgName, userName, userEmail } = await requireOrgContext();

  const [{ data: org }, { data: salesAi, error: salesAiError }] = await Promise.all([
    supabase
      .from("organizations")
      .select("overhead_rate, profit_rate, reply_to")
      .eq("id", orgId)
      .maybeSingle<{ overhead_rate: number; profit_rate: number; reply_to: string | null }>(),
    // api_key は authenticated から列の読み取り権限を外してある。ここでは選ばない
    // （supabase/migrations/20260828000002_sales_ai_connections_admin.sql）
    supabase
      .from("sales_ai_connections")
      .select("base_url, trade_map")
      .eq("org_id", orgId)
      .maybeSingle<SalesAiRow>(),
  ]);
  if (salesAiError) {
    // 読めなくても他の設定は使える。握りつぶさずログには残す
    console.error(`[company] 営業AIの設定を読めませんでした（org=${orgId}）: ${salesAiError.message}`);
  }

  // URLと対応表が揃っていて初めて使える。片方だけでは候補を探せない
  const trades = salesAi?.base_url
    ? Object.entries(salesAi.trade_map ?? {})
        .filter(([, code]) => typeof code === "string" && code.trim() !== "")
        .map(([trade]) => trade)
    : [];

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
      <SalesAiStatus trades={trades} />
    </AppShell>
  );
}
