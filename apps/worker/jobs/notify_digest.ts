// 毎朝1通のダイジェスト（タスク3-2 notify）。
// 参照：docs/実装仕様書_v1.md §8「毎朝1通のダイジェスト（新着提案・今日の期限・未回答の見積）」
//
// 【なぜ必要か】
// 提案（proposals）は作られていたが、誰にも知らされていなかった。
// 毎日ログインしてもらう前提の設計になっており、期限が近い案件を見落とす。
//
// 何を書くかの判定は packages/domain の buildDailyDigest に置き、ここでは
// DBの読み書きとメール送信だけを行う。
//
// 【1日1通を守る】
// notification_log の (org_id, kind, target_date) を送信前に確保する。
// 二重に走っても2通目は一意制約で弾かれる。全部の宛先で送信に失敗したときは
// その行を消して、次の実行でやり直せるようにする（送っていないのに送った記録を残さない）。
//
// 【差出人はサービス】
// 見積依頼や催促は「顧客企業 → 協力会社」だが、ダイジェストは「サービス → 顧客企業」。
// 差出人を取り違えると、誰からの連絡か分からなくなる。

import { createServiceClient } from "@ai-nyusatsu-bu/db";
import { sendEmail, serviceFromAddress } from "@ai-nyusatsu-bu/notifications";
import {
  buildDailyDigest,
  buildDigestEmail,
  buildFromHeader,
  dateOnly,
  type DigestDeadline,
  type DigestProposal,
  type DigestWaitingQuote,
} from "@ai-nyusatsu-bu/domain";

/** 通知の種類。notification_log.kind に入れる。 */
const KIND = "daily_digest";

/** 差出人の表示名。顧客企業の名前ではなくサービス名を出す。 */
const SENDER_NAME = "AI入札部";

/** 提案として扱う状態。対象外は含めない。 */
const ACTIVE_PROPOSAL_STATUSES = ["提案対象", "配信済", "既読", "検討中"];

export type NotifyDigestSummary = {
  /** 見た組織の数 */
  orgs: number;
  /** 送れた組織の数 */
  sent: number;
  /** 送った宛先の延べ数 */
  recipients: number;
  /** 送ろうとして失敗した組織の数（要対応） */
  failed: number;
  /** 送らなかった理由の内訳 */
  skipped: Record<string, number>;
};

type OrgRow = { id: string; name: string };
type UserRow = { email: string };

type ProposalRow = {
  tender_id: string;
  status: string;
  score: number;
  tenders: TenderRef | TenderRef[] | null;
};

type TenderRef = {
  id: string;
  name: string;
  collect_status: string;
  submit_deadline: string | null;
  qa_deadline: string | null;
  bid_open_at: string | null;
};

type WaitingQuoteRow = {
  amount: number | null;
  declined: boolean;
  partners: { name: string } | { name: string }[] | null;
  quote_requests:
    | { org_id: string; trade: string; due_at: string | null; sent_at: string | null; tenders: { id: string; name: string } | { id: string; name: string }[] | null }
    | { org_id: string; trade: string; due_at: string | null; sent_at: string | null; tenders: { id: string; name: string } | { id: string; name: string }[] | null }[]
    | null;
};

function one<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function appUrl(): string {
  return (process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3001").replace(/\/+$/, "");
}

export type NotifyDigestOptions = {
  /** 判定に使う現在時刻。テストや検証のために差し替えられるようにしている */
  now?: Date;
  /** 送らずに、何を送るつもりかだけを返す */
  dryRun?: boolean;
};

export async function runNotifyDigest(options: NotifyDigestOptions = {}): Promise<NotifyDigestSummary> {
  const now = options.now ?? new Date();
  const dryRun = options.dryRun ?? false;
  const client = createServiceClient();
  const targetDate = dateOnly(now);
  if (targetDate === null) throw new Error("現在時刻を日付にできませんでした");

  const { data: orgs, error } = await client.from("organizations").select("id, name").returns<OrgRow[]>();
  if (error) throw new Error(`組織の取得に失敗しました: ${error.message}`);

  const summary: NotifyDigestSummary = { orgs: 0, sent: 0, recipients: 0, failed: 0, skipped: {} };
  const skip = (reason: string) => {
    summary.skipped[reason] = (summary.skipped[reason] ?? 0) + 1;
  };

  for (const org of orgs ?? []) {
    summary.orgs++;
    try {
      const result = await notifyOne(client, org, { now, targetDate, dryRun });
      if (result.sent) {
        summary.sent++;
        summary.recipients += result.recipients;
      } else {
        skip(result.reason);
        if (result.failed) summary.failed++;
      }
    } catch (err) {
      // 1社で失敗しても他社の通知は続ける。握りつぶさずログに残す
      summary.failed++;
      console.error(`[notify_digest] 組織の処理に失敗しました（org=${org.id}）`, err);
    }
  }

  return summary;
}

type OneResult = { sent: true; recipients: number } | { sent: false; reason: string; failed: boolean };

async function notifyOne(
  client: ReturnType<typeof createServiceClient>,
  org: OrgRow,
  ctx: { now: Date; targetDate: string; dryRun: boolean },
): Promise<OneResult> {
  const [proposals, waitingQuotes] = await Promise.all([loadProposals(client, org.id), loadWaitingQuotes(client, org.id)]);

  const newProposals: DigestProposal[] = [];
  const deadlines: DigestDeadline[] = [];
  for (const row of proposals) {
    const tender = one(row.tenders);
    if (!tender) continue;
    if (row.status === "提案対象") {
      newProposals.push({
        tenderId: tender.id,
        tenderName: tender.name,
        score: row.score,
        submitDeadline: tender.submit_deadline,
      });
    }
    // 期限は、まだ終わっていない案件だけを見る
    if (tender.collect_status === "終了") continue;
    deadlines.push({ tenderId: tender.id, tenderName: tender.name, kind: "質問期限", at: tender.qa_deadline });
    deadlines.push({ tenderId: tender.id, tenderName: tender.name, kind: "提出期限", at: tender.submit_deadline });
    deadlines.push({ tenderId: tender.id, tenderName: tender.name, kind: "開札", at: tender.bid_open_at });
  }

  const digest = buildDailyDigest({ orgName: org.name, newProposals, deadlines, waitingQuotes, appUrl: appUrl() }, ctx.now);
  if (!digest.send) return { sent: false, reason: digest.skipReason ?? "知らせることがありません", failed: false };

  const recipients = await loadRecipients(client, org.id);
  if (recipients.length === 0) return { sent: false, reason: "宛先が登録されていません", failed: false };

  const email = buildDigestEmail(digest, { orgName: org.name, appUrl: appUrl() });

  if (ctx.dryRun) {
    console.log(`--- ${org.name}（宛先${recipients.length}件）`);
    console.log(email.subject);
    console.log(email.text);
    return { sent: false, reason: "下見のため送っていません", failed: false };
  }

  // 送る前に「本日ぶん」を確保する。二重に走っても2通目は一意制約で弾かれる
  const { data: claim, error: claimError } = await client
    .from("notification_log")
    .insert({ org_id: org.id, kind: KIND, target_date: ctx.targetDate, recipients: 0 })
    .select("id")
    .maybeSingle<{ id: string }>();
  if (claimError) {
    // 一意制約に当たった＝今日はもう送っている
    if (claimError.code === "23505") return { sent: false, reason: "本日は送信済み", failed: false };
    throw new Error(`通知の記録に失敗しました: ${claimError.message}`);
  }

  let delivered = 0;
  for (const to of recipients) {
    try {
      await sendEmail({ to, subject: email.subject, text: email.text, from: buildFromHeader(SENDER_NAME, serviceFromAddress()) });
      delivered++;
    } catch (err) {
      console.error(`[notify_digest] 送信に失敗しました（org=${org.id} to=${to}）`, err);
    }
  }

  if (delivered === 0) {
    // 送っていないのに送った記録を残さない。消して次の実行でやり直せるようにする
    if (claim) await client.from("notification_log").delete().eq("id", claim.id);
    return { sent: false, reason: "すべての宛先で送信に失敗", failed: true };
  }

  if (claim) await client.from("notification_log").update({ recipients: delivered }).eq("id", claim.id);

  // 知らせた提案を配信済にする。次のダイジェストで同じものを新着として出さない
  if (digest.newProposals.length > 0) {
    const tenderIds = digest.newProposals.map((p) => p.tenderId);
    const { error: markError } = await client
      .from("proposals")
      .update({ status: "配信済", delivered_at: ctx.now.toISOString() })
      .eq("org_id", org.id)
      .eq("status", "提案対象")
      .in("tender_id", tenderIds);
    if (markError) {
      // 送信そのものは成功している。次回に同じ提案が出るだけなので、記録して続ける
      console.error(`[notify_digest] 提案を配信済にできませんでした（org=${org.id}）`, markError);
    }
  }

  return { sent: true, recipients: delivered };
}

async function loadProposals(client: ReturnType<typeof createServiceClient>, orgId: string): Promise<ProposalRow[]> {
  const { data, error } = await client
    .from("proposals")
    .select("tender_id, status, score, tenders!inner(id, name, collect_status, submit_deadline, qa_deadline, bid_open_at)")
    .eq("org_id", orgId)
    .in("status", ACTIVE_PROPOSAL_STATUSES)
    .returns<ProposalRow[]>();
  if (error) throw new Error(`提案の取得に失敗しました: ${error.message}`);
  return data ?? [];
}

async function loadWaitingQuotes(client: ReturnType<typeof createServiceClient>, orgId: string): Promise<DigestWaitingQuote[]> {
  const { data, error } = await client
    .from("quotes")
    .select("amount, declined, partners(name), quote_requests!inner(org_id, trade, due_at, sent_at, tenders!inner(id, name))")
    .eq("quote_requests.org_id", orgId)
    .is("amount", null)
    .eq("declined", false)
    .not("quote_requests.sent_at", "is", null)
    .returns<WaitingQuoteRow[]>();
  if (error) throw new Error(`未回答の見積の取得に失敗しました: ${error.message}`);

  const waiting: DigestWaitingQuote[] = [];
  for (const row of data ?? []) {
    const request = one(row.quote_requests);
    const tender = one(request?.tenders);
    if (!request || !tender) continue;
    waiting.push({
      tenderId: tender.id,
      tenderName: tender.name,
      trade: request.trade,
      partnerName: one(row.partners)?.name ?? "（会社名未登録）",
      dueAt: request.due_at,
    });
  }
  return waiting;
}

async function loadRecipients(client: ReturnType<typeof createServiceClient>, orgId: string): Promise<string[]> {
  const { data, error } = await client.from("users").select("email").eq("org_id", orgId).returns<UserRow[]>();
  if (error) throw new Error(`宛先の取得に失敗しました: ${error.message}`);
  return (data ?? []).map((u) => u.email).filter((email) => email.trim() !== "");
}
