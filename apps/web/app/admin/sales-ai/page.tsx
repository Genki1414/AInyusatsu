// 本部側の営業AI（eigyouAI）接続設定（T55の続き）。
//
// 【なぜこの画面が要るか】
// 「顧客は営業AIの画面を開かない」（ユーザー決定 2026-08-28）。本部が営業AIの
// テナントを作り、APIキーを顧客に見せずそのまま保存する場所が要る
// （それまでは apps/web/app/company の画面に顧客自身が貼る形しか無かった）。
//
// 【送信元は契約者本人の名義にする】
// 協力会社開拓の問い合わせフォームに載る送信元は、AI入札部自身のアドレスではなく
// 契約者本人の名義にする（ユーザー決定 2026-08-28）。ここでその送信元も設定する。
//
// 【顧客の画面ではない】
// 組織をまたいで見るため service_role で読む。requireAdmin が運営であることを
// 確かめたうえでクライアントを渡す（apps/web/lib/admin.ts）。
//
// 【対応が要るものを上に出す】
// 未接続（まだテナントを作っていない）組織を先頭に並べる。

import Link from "next/link";
import { Panel } from "@/components/ui";
import { requireAdmin } from "@/lib/admin";
import { ConnectionRowForms, type ConnectionRow } from "./forms";

type OrgRow = { id: string; name: string };
type ConnRow = {
  org_id: string;
  base_url: string;
  api_key: string;
  tenant_id: number | null;
  trade_map: Record<string, string>;
  checked_at: string | null;
  check_error: string | null;
};

export default async function AdminSalesAiPage() {
  const { email, admin } = await requireAdmin();

  const [orgs, conns] = await Promise.all([
    admin.from("organizations").select("id, name").order("created_at", { ascending: false }).returns<OrgRow[]>(),
    admin
      .from("sales_ai_connections")
      .select("org_id, base_url, api_key, tenant_id, trade_map, checked_at, check_error")
      .returns<ConnRow[]>(),
  ]);

  // 読めなかったことを隠さない（CLAUDE.md「エラーは握りつぶさない」）。
  // 一覧が不完全なまま「未接続」と誤表示すると、テナントを二重に作ってしまう
  const loadError = orgs.error?.message ?? conns.error?.message ?? null;
  if (loadError) console.error(`[admin] 営業AI接続一覧の取得に失敗しました: ${loadError}`);

  const connByOrg = new Map((conns.data ?? []).map((c) => [c.org_id, c]));

  const rows: ConnectionRow[] = (orgs.data ?? []).map((org) => {
    const c = connByOrg.get(org.id) ?? null;
    return {
      orgId: org.id,
      orgName: org.name,
      baseUrl: c?.base_url ?? "",
      apiKey: c?.api_key ?? null,
      tenantId: c?.tenant_id ?? null,
      tradeMap: c?.trade_map ?? {},
      checkedAt: c?.checked_at ?? null,
      checkError: c?.check_error ?? null,
    };
  });
  // 対応が要るもの（未接続）を先頭に
  const sorted = [...rows].sort((a, b) => Number(a.tenantId !== null) - Number(b.tenantId !== null));
  const connectedCount = rows.filter((row) => row.tenantId !== null).length;

  return (
    <div className="mx-auto max-w-4xl space-y-3 p-4">
      <header className="flex flex-wrap items-center gap-2">
        <h1 className="text-sm font-semibold text-slate-800">営業AI連携</h1>
        <Link href="/admin" className="text-xs text-slate-500 underline hover:text-slate-700">
          運営トップ
        </Link>
        <span className="ml-auto text-xs text-slate-400">{email}</span>
      </header>

      <p className="text-xs leading-relaxed text-slate-500">
        AI入札部の契約者を営業AI（ヒラケル）のテナントとして登録する（本部の作業）。
        APIキーは顧客には見せない。協力会社開拓の問い合わせフォームには、下で設定する
        「送信元（顧客名義）」＝契約者本人の名義が載る（AI入札部自身のアドレスにはしない）。
      </p>

      {loadError && (
        <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2">
          <p className="text-xs text-rose-900">
            一覧を読み込めませんでした（{loadError}）。表示されている内容は不完全です。
            この状態でテナントを作ると、既にある接続を見落として重複するおそれがあるため、先に原因を確認してください。
          </p>
        </div>
      )}

      <Panel title={`接続（テナント作成済み ${connectedCount} / 全 ${rows.length}）`}>
        {sorted.length === 0 ? (
          <p className="text-xs text-slate-500">
            アカウントはまだありません。先に<Link href="/admin/accounts" className="underline">アカウント</Link>を発行してください。
          </p>
        ) : (
          <div>
            {sorted.map((row) => (
              <ConnectionRowForms key={row.orgId} row={row} />
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
