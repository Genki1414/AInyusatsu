"use server";

// 営業AI開拓の返信を、協力会社として登録する（結果の取り込み。T55の続き）。
//
// docs/reference/営業AI連携_設計.md「3. 結果（未実装）」の実装:
//   営業AI：送信結果を form_send_log と target_list_members に持つ
//     ↓
//   AI入札部：GET /api/tenant/lists/<id>?status=replied で返信のあった会社を引く
//     ↓
//   利用者：「協力会社として登録する」
//     ↓
//   AI入札部：partners に追加
//
// 【送信は行わない】
// ここは返信の確認と登録だけ。フォームへの送信は sendOutreach（outreach-actions.ts）
// の範囲で、この画面から新たに送信を呼ぶ処理は書かない。
//
// 【クライアントから来た会社データを信用しない】
// 登録時は、選ばれた会社IDだけを使って営業AI側からもう一度読み直す
// （画面に出ていた社名・連絡先をそのまま信じてpartnersへ書き込まない）。

import { revalidatePath } from "next/cache";
import { listRepliedMembers, OutreachError, type RepliedMember } from "@ai-nyusatsu-bu/outreach";
import { requireOrgContext } from "@/lib/auth";
import { rematchOrgProposals } from "@/lib/rematch";

function describe(err: unknown): string {
  return err instanceof OutreachError ? `${err.code}：${err.message}` : String(err);
}

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

export type RepliedCandidate = RepliedMember & { alreadyPartner: boolean };

export type CheckRepliesState = {
  error: string | null;
  candidates: RepliedCandidate[];
  /** どの業種で確認したか。画面側でチェックボックスのkeyに使う */
  trade: string | null;
};

const EMPTY_CHECK: CheckRepliesState = { error: null, candidates: [], trade: null };

/** この案件×業種で、これまでに作った送信先リストのlist_idを全部集める。 */
async function loadListIds(
  supabase: Awaited<ReturnType<typeof requireOrgContext>>["supabase"],
  orgId: string,
  tenderId: string,
  trade: string,
): Promise<number[]> {
  const { data } = await supabase
    .from("sales_ai_outreach_lists")
    .select("list_id")
    .eq("org_id", orgId)
    .eq("tender_id", tenderId)
    .eq("trade", trade)
    .returns<{ list_id: number }[]>();
  return (data ?? []).map((row) => row.list_id);
}

/** 選ばれた業種の、返信があった会社を営業AI側から集める（list_idが重複していても会社は1回だけ）。 */
async function collectRepliedMembers(
  connection: { baseUrl: string; apiKey: string },
  listIds: number[],
): Promise<Map<number, RepliedMember>> {
  const byCompany = new Map<number, RepliedMember>();
  for (const listId of listIds) {
    const members = await listRepliedMembers(connection, listId);
    for (const member of members) {
      if (!byCompany.has(member.companyId)) byCompany.set(member.companyId, member);
    }
  }
  return byCompany;
}

/** 返信があった会社を確認する。登録はまだしない。 */
export async function checkRepliedCandidates(
  _prevState: CheckRepliesState,
  formData: FormData,
): Promise<CheckRepliesState> {
  const tenderId = text(formData, "tender_id");
  const trade = text(formData, "trade");
  if (tenderId === "" || trade === "") return { ...EMPTY_CHECK, error: "案件または業種が指定されていません" };

  const { supabase, orgId } = await requireOrgContext();
  const { data: connection } = await supabase
    .from("sales_ai_connections")
    .select("base_url, api_key")
    .eq("org_id", orgId)
    .maybeSingle<{ base_url: string; api_key: string }>();
  if (!connection) return { ...EMPTY_CHECK, error: "営業AIの接続設定がありません" };

  const listIds = await loadListIds(supabase, orgId, tenderId, trade);
  if (listIds.length === 0) return { ...EMPTY_CHECK, error: "この業種ではまだ送信していません" };

  let byCompany: Map<number, RepliedMember>;
  try {
    byCompany = await collectRepliedMembers({ baseUrl: connection.base_url, apiKey: connection.api_key }, listIds);
  } catch (err) {
    return { ...EMPTY_CHECK, error: `返信を確認できませんでした（${describe(err)}）` };
  }
  if (byCompany.size === 0) {
    return { error: null, candidates: [], trade };
  }

  // 既に協力会社として登録済みの会社は印を付ける（メールアドレスで見分ける。二重登録の目安）
  const { data: existingPartners } = await supabase
    .from("partners")
    .select("email")
    .eq("org_id", orgId)
    .returns<{ email: string | null }[]>();
  const existingEmails = new Set(
    (existingPartners ?? []).map((p) => (p.email ?? "").toLowerCase()).filter((email) => email !== ""),
  );

  const candidates: RepliedCandidate[] = [...byCompany.values()].map((member) => ({
    ...member,
    alreadyPartner: Boolean(member.email && existingEmails.has(member.email.toLowerCase())),
  }));
  return { error: null, candidates, trade };
}

export type RegisterRepliesState = { error: string | null; message: string | null };
const EMPTY_REGISTER: RegisterRepliesState = { error: null, message: null };

/** 選んだ会社を協力会社として登録する。 */
export async function registerRepliedPartners(
  _prevState: RegisterRepliesState,
  formData: FormData,
): Promise<RegisterRepliesState> {
  const tenderId = text(formData, "tender_id");
  const trade = text(formData, "trade");
  const selectedIds = new Set(
    formData
      .getAll("company_id")
      .map((v) => Number(v))
      .filter((n) => Number.isInteger(n)),
  );
  if (tenderId === "" || trade === "") return { ...EMPTY_REGISTER, error: "案件または業種が指定されていません" };
  if (selectedIds.size === 0) return { ...EMPTY_REGISTER, error: "登録する会社を選んでください" };

  const { supabase, orgId } = await requireOrgContext();
  const { data: connection } = await supabase
    .from("sales_ai_connections")
    .select("base_url, api_key")
    .eq("org_id", orgId)
    .maybeSingle<{ base_url: string; api_key: string }>();
  if (!connection) return { ...EMPTY_REGISTER, error: "営業AIの接続設定がありません" };

  const listIds = await loadListIds(supabase, orgId, tenderId, trade);
  if (listIds.length === 0) return { ...EMPTY_REGISTER, error: "この業種ではまだ送信していません" };

  // 画面から来た会社データは使わず、選ばれたIDだけを営業AI側からもう一度読み直す
  let byCompany: Map<number, RepliedMember>;
  try {
    byCompany = await collectRepliedMembers({ baseUrl: connection.base_url, apiKey: connection.api_key }, listIds);
  } catch (err) {
    return { ...EMPTY_REGISTER, error: `営業AIから読み直せませんでした（${describe(err)}）` };
  }
  const wanted = [...byCompany.values()].filter((member) => selectedIds.has(member.companyId));
  if (wanted.length === 0) {
    return { ...EMPTY_REGISTER, error: "選んだ会社が見つかりませんでした（既に取り消された可能性があります）" };
  }

  const { data: existingPartners } = await supabase
    .from("partners")
    .select("email")
    .eq("org_id", orgId)
    .returns<{ email: string | null }[]>();
  const existingEmails = new Set(
    (existingPartners ?? []).map((p) => (p.email ?? "").toLowerCase()).filter((email) => email !== ""),
  );

  let registered = 0;
  let skipped = 0;
  for (const member of wanted) {
    if (member.email && existingEmails.has(member.email.toLowerCase())) {
      skipped += 1;
      continue;
    }
    const { error } = await supabase.from("partners").insert({
      org_id: orgId,
      name: member.name,
      email: member.email,
      tel: member.phone,
      base: member.pref,
      trades: [trade],
      memo: `営業AI開拓（${trade}）の返信から登録`,
    });
    if (error) {
      console.error("[outreach-import] 協力会社の登録に失敗しました", error);
      skipped += 1;
      continue;
    }
    registered += 1;
    if (member.email) existingEmails.add(member.email.toLowerCase());
  }

  if (registered > 0) {
    // 協力会社の保有状況はfit.tsの「協力会社の保有」に影響するため、他の登録経路
    // （apps/web/app/partners/actions.ts）と同様に自組織のproposalsを再照合する。
    await rematchOrgProposals(supabase, orgId);
    revalidatePath("/partners");
    revalidatePath(`/tenders/${tenderId}`);
  }

  return {
    error: null,
    message: `${registered}社を協力会社として登録しました。${skipped > 0 ? `${skipped}社は登録済みのためスキップしました。` : ""}`,
  };
}
