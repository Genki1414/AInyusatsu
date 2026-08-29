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
import { additionalLoginMonthlyYen, formatTradeMap, maskApiKey, type TradeMap } from "@ai-nyusatsu-bu/domain";
import { Panel } from "@/components/ui";
import { requireAdmin } from "@/lib/admin";
import { AccountRowForms, IssueForm, PendingRequests, type AccountRow, type PendingRequest } from "./account-forms";
import { EMPTY_SALES_AI_VIEW, SalesAiRowForm, type SalesAiAdminView } from "./sales-ai-forms";

type OrgRow = { id: string; name: string; created_at: string };
type UserRow = { id: string; org_id: string; email: string; name: string; role: string; created_at: string };
type AccessRow = { org_id: string; status: string; suspended_reason: string | null };
type RequestRow = {
  id: string;
  org_id: string;
  name: string;
  email: string;
  note: string | null;
  created_at: string;
};
type SalesAiRow = {
  org_id: string;
  base_url: string;
  api_key: string;
  trade_map: TradeMap | null;
  checked_at: string | null;
  check_error: string | null;
};

function jst(at: string | null): string {
  if (at === null) return "—";
  const parsed = new Date(at);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" });
}

function jstAt(at: string | null): string | null {
  if (at === null) return null;
  const parsed = new Date(at);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
}

/** APIキーは伏せ字にしてから画面へ渡す。実物はサーバーから出さない。 */
function toSalesAiView(row: SalesAiRow): SalesAiAdminView {
  const tradeMap = row.trade_map ?? {};
  return {
    baseUrl: row.base_url,
    maskedApiKey: maskApiKey(row.api_key),
    hasKey: Boolean(row.api_key),
    tradeMapText: formatTradeMap(tradeMap),
    tradeCount: Object.keys(tradeMap).length,
    checkedAtLabel: jstAt(row.checked_at),
    checkError: row.check_error,
  };
}

export default async function AdminAccountsPage() {
  const { email, admin } = await requireAdmin();

  const [orgs, users, access, salesAi, pendingRows] = await Promise.all([
    admin.from("organizations").select("id, name, created_at").order("created_at", { ascending: false }).returns<OrgRow[]>(),
    admin.from("users").select("id, org_id, email, name, role, created_at").returns<UserRow[]>(),
    admin.from("org_access").select("org_id, status, suspended_reason").returns<AccessRow[]>(),
    admin
      .from("sales_ai_connections")
      .select("org_id, base_url, api_key, trade_map, checked_at, check_error")
      .returns<SalesAiRow[]>(),
    admin
      .from("account_requests")
      .select("id, org_id, name, email, note, created_at")
      .eq("status", "依頼中")
      .order("created_at", { ascending: true })
      .returns<RequestRow[]>(),
  ]);

  // 読めなかったことを隠さない（CLAUDE.md「エラーは握りつぶさない」）。
  // 一覧が空なのか読めなかったのかが分からないと、発行済みのアカウントを二重に作ってしまう
  const loadError = orgs.error?.message ?? users.error?.message ?? access.error?.message ?? null;
  if (loadError) console.error(`[admin] アカウント一覧の取得に失敗しました: ${loadError}`);
  // 営業AIの設定が読めなくても、発行・停止はできる。分けてログに残す
  if (salesAi.error) console.error(`[admin] 営業AIの接続設定を読めませんでした: ${salesAi.error.message}`);

  if (pendingRows.error) console.error(`[admin] アカウント追加の依頼を読めませんでした: ${pendingRows.error.message}`);

  const salesAiByOrg = new Map((salesAi.data ?? []).map((row) => [row.org_id, toSalesAiView(row)]));

  // 組織ごとのログイン数。発行するといくらになるかを出すのに要る
  const loginCountByOrg = new Map<string, number>();
  for (const user of users.data ?? []) {
    loginCountByOrg.set(user.org_id, (loginCountByOrg.get(user.org_id) ?? 0) + 1);
  }
  const orgNameById = new Map((orgs.data ?? []).map((org) => [org.id, org.name]));

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
      userName: owner?.name ?? null,
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

      {/* 依頼は放置すると顧客が待たされる。発行フォームのすぐ下に置く */}
      <PendingRequests
        requests={(pendingRows.data ?? []).map((row): PendingRequest => {
          const after = (loginCountByOrg.get(row.org_id) ?? 0) + 1;
          return {
            id: row.id,
            orgId: row.org_id,
            orgName: orgNameById.get(row.org_id) ?? "（組織名不明）",
            name: row.name,
            email: row.email,
            note: row.note,
            createdOn: jst(row.created_at),
            loginsAfter: after,
            monthlyAfter: additionalLoginMonthlyYen(after),
          };
        })}
      />

      <Panel title={`アカウント一覧（利用中 ${activeCount} / 全 ${rows.length}）`}>
        {sorted.length === 0 ? (
          <p className="text-xs text-slate-500">アカウントはまだありません。</p>
        ) : (
          <div>
            {sorted.map((row) => (
              <div key={row.orgId}>
                <AccountRowForms row={row} />
                {/* 営業AIのテナントは本部が作り、キーも本部が持つ（顧客は営業AIを触らない）。
                    docs/reference/営業AI連携_設計.md */}
                <SalesAiRowForm orgId={row.orgId} view={salesAiByOrg.get(row.orgId) ?? EMPTY_SALES_AI_VIEW} />
                <p className="pb-1 pt-1 text-xs text-slate-400">発行日 {jst(row.createdAt)}</p>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
