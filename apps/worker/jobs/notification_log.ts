// 送った通知の記録（タスク3-2）。毎朝のダイジェストと即時通知が共通で使う。
//
// 【送る前に確保する】
// 通知は「送ったかどうか」を先に決めないと、二重に走ったときに2通目が飛ぶ。
// notification_log の (org_id, dedupe_key) を送信前に確保し、一意制約に当たったら
// 「もう送った」とみなして何もしない。
//
// 【送れなかったら記録を消す】
// 全部の宛先で送信に失敗したのに記録だけ残ると、その通知は二度と送られない。
// 期限が近いことを知らせる通知でそれが起きると、そのまま参加できなくなる。

import type { createServiceClient } from "@ai-nyusatsu-bu/db";

type Client = ReturnType<typeof createServiceClient>;

/** Postgres の一意制約違反。 */
const UNIQUE_VIOLATION = "23505";

export type ClaimInput = {
  orgId: string;
  /** 通知の種類（daily_digest / 質問期限 / 提出期限 / 見積の返信） */
  kind: string;
  /** 何に対する通知か。組織ごとに一意 */
  dedupeKey: string;
  /** 送信日（Asia/Tokyo の YYYY-MM-DD） */
  targetDate: string;
};

export type ClaimResult = { claimed: true; id: string } | { claimed: false };

/** 送る権利を確保する。すでに送っていれば claimed: false。 */
export async function claimNotification(client: Client, input: ClaimInput): Promise<ClaimResult> {
  const { data, error } = await client
    .from("notification_log")
    .insert({
      org_id: input.orgId,
      kind: input.kind,
      dedupe_key: input.dedupeKey,
      target_date: input.targetDate,
      recipients: 0,
    })
    .select("id")
    .maybeSingle<{ id: string }>();

  if (error) {
    if (error.code === UNIQUE_VIOLATION) return { claimed: false };
    throw new Error(`通知の記録に失敗しました（${input.dedupeKey}）: ${error.message}`);
  }
  if (!data) throw new Error(`通知の記録を作れませんでした（${input.dedupeKey}）`);
  return { claimed: true, id: data.id };
}

/** 送れなかったので確保を取り消す。次の実行でやり直せるようにする。 */
export async function releaseNotification(client: Client, id: string): Promise<void> {
  const { error } = await client.from("notification_log").delete().eq("id", id);
  if (error) {
    // 消せないと、その通知は二度と送られない。気づけるようにログに残す
    console.error(`[notification_log] 送れなかった記録を消せませんでした（id=${id}）: ${error.message}`);
  }
}

/** 実際に送れた宛先の数を残す。0のままなら送信に失敗している。 */
export async function recordRecipients(client: Client, id: string, recipients: number): Promise<void> {
  const { error } = await client.from("notification_log").update({ recipients }).eq("id", id);
  if (error) console.error(`[notification_log] 宛先数を記録できませんでした（id=${id}）: ${error.message}`);
}

/** すでに送ったか（下見のときに「送信済み」と示すために使う。送信の判定には使わない）。 */
export async function hasSentNotification(client: Client, orgId: string, dedupeKey: string): Promise<boolean> {
  const { data, error } = await client
    .from("notification_log")
    .select("id")
    .eq("org_id", orgId)
    .eq("dedupe_key", dedupeKey)
    .maybeSingle<{ id: string }>();
  if (error) {
    console.error(`[notification_log] 送信済みかを確かめられませんでした（${dedupeKey}）: ${error.message}`);
    return false;
  }
  return data !== null;
}

/** 組織に登録されている宛先。 */
export async function loadRecipients(client: Client, orgId: string): Promise<string[]> {
  const { data, error } = await client.from("users").select("email").eq("org_id", orgId).returns<{ email: string }[]>();
  if (error) throw new Error(`宛先の取得に失敗しました: ${error.message}`);
  return (data ?? []).map((u) => u.email).filter((email) => email.trim() !== "");
}

/** 案件へのリンクの土台。 */
export function appUrl(): string {
  return (process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3001").replace(/\/+$/, "");
}
