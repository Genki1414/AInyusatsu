// 本部のアカウント管理（タスク4-8の続き）。発行・停止・パスワード再発行。
//
// 【なぜこの画面が要るか】
// 支払いは請求書払いのみ（ユーザー決定 2026-08-25）。カード決済のように自動で
// 契約が始まらず、止まりもしないため、誰が使えるかを本部が手で決める場所が要る。
//
// 【顧客の画面ではない】
// 組織をまたいで見るため service_role で読む。requireAdmin が運営であることを
// 確かめたうえでクライアントを渡す（apps/web/lib/admin.ts）。
//
// 【対応が要るものを上に出す】
// 停止中の組織を先頭に並べる。件数が増えたときに、放置されている契約が
// 一覧の下に埋もれないようにする。

import Link from "next/link";
import { Panel } from "@/components/ui";
import { requireAdmin } from "@/lib/admin";
import { AccountRowForms, IssueForm, type AccountRow } from "./account-forms";

type OrgRow = { id: string; name: string; created_at: string };
type UserRow = { id: string; org_id: string; email: string; role: string; created_at: string };
type AccessRow = { org_id: string; status: string; suspended_reason: string | null };

function jst(at: string | null): string {
  if (at === null) return "—";
  const parsed = new Date(at);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" });
}

export default async function AdminAccountsPage() {
  const { email, admin } = await requireAdmin();

  const [orgs, users, access] = await Promise.all([
    admin.from("organizations").select("id, name, created_at").order("created_at", { ascending: false }).returns<OrgRow[]>(),
    admin.from("users").select("id, org_id, email, role, created_at").returns<UserRow[]>(),
    admin.from("org_access").select("org_id, status, suspended_reason").returns<AccessRow[]>(),
  ]);

  // 読めなかったことを隠さない（CLAUDE.md「エラーは握りつぶさない」）。
  // 一覧が空なのか読めなかったのかが分からないと、発行済みのアカウントを二重に作ってしまう
  const loadError = orgs.error?.message ?? users.error?.message ?? access.error?.message ?? null;
  if (loadError) console.error(`[admin] アカウント一覧の取得に失敗しました: ${loadError}`);

  const accessByOrg = new Map((access.data ?? []).map((row) => [row.org_id, row]));
  const ownerByOrg = new Map<string, UserRow>();
  for (const user of users.data ?? []) {
    const current = ownerByOrg.get(user.org_id);
    // owner を優先し、同じ役割なら先に作られたほうを代表とする
    if (!current) ownerByOrg.set(user.org_id, user);
    else if (current.role !== "owner" && user.role === "owner") ownerByOrg.set(user.org_id, user);
    else if (current.role === user.role && user.created_at < current.created_at) ownerByOrg.set(user.org_id, user);
  }

  const rows: AccountRow[] = (orgs.data ?? []).map((org) => {
    const owner = ownerByOrg.get(org.id) ?? null;
    const state = accessByOrg.get(org.id);
    return {
      orgId: org.id,
      orgName: org.name,
      // 行が無い組織も停止として扱う（supabase/migrations/20260825000007_org_access.sql）
      status: state?.status ?? "停止",
      suspendedReason: state?.suspended_reason ?? null,
      userId: owner?.id ?? null,
      email: owner?.email ?? null,
      createdAt: org.created_at,
    };
  });
  // 対応が要るもの（停止中）を先頭に。同じ状態のなかでは新しい順（上のクエリのまま）
  const sorted = [...rows].sort((a, b) => Number(a.status === "利用中") - Number(b.status === "利用中"));
  const activeCount = rows.filter((row) => row.status === "利用中").length;

  return (
    <div className="mx-auto max-w-4xl space-y-3 p-4">
      <header className="flex flex-wrap items-center gap-2">
        <h1 className="text-sm font-semibold text-slate-800">アカウント</h1>
        <Link href="/admin" className="text-xs text-slate-500 underline hover:text-slate-700">
          運営トップ
        </Link>
        <span className="ml-auto text-xs text-slate-400">{email}</span>
      </header>

      {loadError && (
        <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2">
          <p className="text-xs text-rose-900">
            一覧を読み込めませんでした（{loadError}）。表示されている内容は不完全です。
            この状態で発行すると重複するおそれがあるため、先に原因を確認してください。
          </p>
        </div>
      )}

      <IssueForm />

      <Panel title={`アカウント一覧（利用中 ${activeCount} / 全 ${rows.length}）`}>
        {sorted.length === 0 ? (
          <p className="text-xs text-slate-500">アカウントはまだありません。</p>
        ) : (
          <div>
            {sorted.map((row) => (
              <div key={row.orgId}>
                <AccountRowForms row={row} />
                <p className="-mt-1 pb-1 text-xs text-slate-400">発行日 {jst(row.createdAt)}</p>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
