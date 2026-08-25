// 即時通知（タスク3-2 notify）。
// 参照：docs/実装仕様書_v1.md §8「即時通知は3つだけ：質問期限48時間前、提出期限48時間前、見積の返信受信」
//
// 毎朝のダイジェストを待つと手遅れになるものだけを、その場で知らせる。
//   - 質問期限・提出期限：過ぎたら参加できない（CLAUDE.md 最重要の前提5）
//   - 見積の返信：応札価格を決める材料。届いたことに気づかないと商談が止まる
//
// 何を送るかの判定は packages/domain の instant_notice に置き、ここでは
// DBの読み書きとメール送信だけを行う。
//
// 【1件につき1回だけ】
// このジョブは毎時走る。記録が無いと、同じ期限の通知が48時間ぶん繰り返し飛ぶ。
// notification_log の dedupe_key を送信前に確保して、1件につき1回だけにする。
//
// 【期限は案件ではなく提案の単位で見る】
// 案件は全ユーザー共通の1レコード（CLAUDE.md 最重要の前提1）。
// 誰に知らせるかは、その案件を提案されている組織で決まる。

import { createServiceClient } from "@ai-nyusatsu-bu/db";
import { sendEmail, serviceFromAddress } from "@ai-nyusatsu-bu/notifications";
import {
  buildDeadlineNoticeEmail,
  buildFromHeader,
  buildQuoteReplyNoticeEmail,
  dateOnly,
  deadlineDedupeKey,
  dueDeadlineNotices,
  quoteReplyDedupeKey,
  type DeadlineCandidate,
  type NoticeEmail,
  type QuoteReplyNotice,
} from "@ai-nyusatsu-bu/domain";
import {
  appUrl,
  claimNotification,
  hasSentNotification,
  loadRecipients,
  recordRecipients,
  releaseNotification,
} from "./notification_log";

/** 差出人の表示名。顧客企業の名前ではなくサービス名を出す。 */
const SENDER_NAME = "AI入札部";

/**
 * 期限の通知を出す提案の状態。
 * 対象外には送らない（参加しない案件の期限を知らせても意味がない）。
 */
const NOTIFIABLE_PROPOSAL_STATUSES = ["提案対象", "配信済", "既読", "検討中"];

/** 見積の返信を何時間ぶんさかのぼって見るか。取りこぼしても次の実行で拾えるよう余裕を持たせる。 */
const INBOUND_LOOKBACK_HOURS = 72;

export type NotifyInstantSummary = {
  /** 送れた通知の数（宛先の延べ数ではない） */
  sent: number;
  /** 種類ごとの内訳 */
  byKind: Record<string, number>;
  /** 送ろうとして失敗した数（要対応） */
  failed: number;
  /** 送らなかった理由の内訳 */
  skipped: Record<string, number>;
};

export type NotifyInstantOptions = {
  now?: Date;
  dryRun?: boolean;
};

type Client = ReturnType<typeof createServiceClient>;

type TenderRef = {
  id: string;
  name: string;
  collect_status: string;
  submit_deadline: string | null;
  qa_deadline: string | null;
};

type ProposalRow = {
  org_id: string;
  organizations: { name: string } | { name: string }[] | null;
  tenders: TenderRef | TenderRef[] | null;
};

type InboundRow = {
  id: string;
  org_id: string | null;
  received_at: string;
  parsed_amount: number | null;
  attachments: unknown;
  organizations: { name: string } | { name: string }[] | null;
  quotes: QuoteRef | QuoteRef[] | null;
};

type QuoteRef = {
  partners: { name: string } | { name: string }[] | null;
  quote_requests: { trade: string; tenders: { id: string; name: string } | { id: string; name: string }[] | null } | null;
};

function one<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export async function runNotifyInstant(options: NotifyInstantOptions = {}): Promise<NotifyInstantSummary> {
  const now = options.now ?? new Date();
  const dryRun = options.dryRun ?? false;
  const client = createServiceClient();
  const targetDate = dateOnly(now);
  if (targetDate === null) throw new Error("現在時刻を日付にできませんでした");

  const summary: NotifyInstantSummary = { sent: 0, byKind: {}, failed: 0, skipped: {} };
  const ctx = { now, targetDate, dryRun, summary };

  await notifyDeadlines(client, ctx);
  await notifyQuoteReplies(client, ctx);

  return summary;
}

type Ctx = { now: Date; targetDate: string; dryRun: boolean; summary: NotifyInstantSummary };

function skip(ctx: Ctx, reason: string): void {
  ctx.summary.skipped[reason] = (ctx.summary.skipped[reason] ?? 0) + 1;
}

/** 質問期限・提出期限が48時間を切った案件を知らせる。 */
async function notifyDeadlines(client: Client, ctx: Ctx): Promise<void> {
  // 【なぜSQLで期限まで絞らないか】
  // 「質問期限か提出期限のどちらかが48時間以内」を1本のSQLで書くと入れ子の条件になり、
  // 境界の扱いがドメイン側と食い違いやすい。期限の判定を2か所に置くと、片方だけ直した
  // ときに気づけない（期限の誤りは失格に直結する）。
  // 対象は「提案されていて、終わっていない案件」だけなので件数は多くない。
  // 絞り込みは dueDeadlineNotices に任せる。
  const { data, error } = await client
    .from("proposals")
    .select("org_id, organizations(name), tenders!inner(id, name, collect_status, submit_deadline, qa_deadline)")
    .in("status", NOTIFIABLE_PROPOSAL_STATUSES)
    .neq("tenders.collect_status", "終了")
    .returns<ProposalRow[]>();
  if (error) throw new Error(`期限が近い提案の取得に失敗しました: ${error.message}`);

  for (const row of data ?? []) {
    const tender = one(row.tenders);
    const orgName = one(row.organizations)?.name;
    if (!tender || !orgName) continue;

    const candidates: DeadlineCandidate[] = [
      { tenderId: tender.id, tenderName: tender.name, kind: "質問期限", at: tender.qa_deadline, collectStatus: tender.collect_status },
      { tenderId: tender.id, tenderName: tender.name, kind: "提出期限", at: tender.submit_deadline, collectStatus: tender.collect_status },
    ];

    for (const notice of dueDeadlineNotices(candidates, ctx.now)) {
      await deliver(client, ctx, {
        orgId: row.org_id,
        kind: notice.kind,
        dedupeKey: deadlineDedupeKey(notice.kind, notice.tenderId),
        email: buildDeadlineNoticeEmail(notice, { orgName, appUrl: appUrl() }),
      });
    }
  }
}

/** 協力会社から見積の返信が届いたことを知らせる。 */
async function notifyQuoteReplies(client: Client, ctx: Ctx): Promise<void> {
  const since = new Date(ctx.now.getTime() - INBOUND_LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();

  const { data, error } = await client
    .from("inbound_messages")
    .select(
      "id, org_id, received_at, parsed_amount, attachments, organizations(name), quotes!inner(partners(name), quote_requests!inner(trade, tenders!inner(id, name)))",
    )
    .not("quote_id", "is", null)
    .gte("received_at", since)
    .returns<InboundRow[]>();
  if (error) throw new Error(`受信した返信の取得に失敗しました: ${error.message}`);

  for (const row of data ?? []) {
    const orgName = one(row.organizations)?.name;
    const quote = one(row.quotes);
    const request = quote?.quote_requests ?? null;
    const tender = one(request?.tenders);
    // 見積を特定できていない返信は、誰に知らせるべきか決まらない（推測で結びつけない）
    if (!row.org_id || !orgName || !tender || !request) {
      skip(ctx, "どの組織への返信か特定できない");
      continue;
    }

    const notice: QuoteReplyNotice = {
      tenderId: tender.id,
      tenderName: tender.name,
      trade: request.trade,
      partnerName: one(quote?.partners)?.name ?? "協力会社",
      parsedAmount: row.parsed_amount,
      attachmentNames: attachmentNames(row.attachments),
    };

    await deliver(client, ctx, {
      orgId: row.org_id,
      kind: "見積の返信",
      dedupeKey: quoteReplyDedupeKey(row.id),
      email: buildQuoteReplyNoticeEmail(notice, { orgName, appUrl: appUrl() }),
    });
  }
}

function attachmentNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === "object" && entry !== null ? (entry as { filename?: unknown }).filename : null))
    .filter((name): name is string => typeof name === "string" && name.trim() !== "");
}

/** 1件の通知を送る。確保 → 送信 → 記録（失敗したら確保を取り消す）。 */
async function deliver(
  client: Client,
  ctx: Ctx,
  input: { orgId: string; kind: string; dedupeKey: string; email: NoticeEmail },
): Promise<void> {
  if (ctx.dryRun) {
    // 下見でも「もう送ったもの」は分かるようにする。全部が新規に見えると判断を誤る
    const already = await hasSentNotification(client, input.orgId, input.dedupeKey);
    console.log(`--- ${input.dedupeKey}${already ? "（送信済み。実行しても送りません）" : ""}`);
    console.log(input.email.subject);
    console.log(input.email.text);
    console.log("");
    skip(ctx, already ? "送信済み" : "下見のため送っていません");
    return;
  }

  let claim: { claimed: true; id: string } | { claimed: false };
  try {
    claim = await claimNotification(client, {
      orgId: input.orgId,
      kind: input.kind,
      dedupeKey: input.dedupeKey,
      targetDate: ctx.targetDate,
    });
  } catch (err) {
    ctx.summary.failed++;
    console.error(`[notify_instant] 通知の記録に失敗しました（${input.dedupeKey}）`, err);
    return;
  }
  if (!claim.claimed) {
    skip(ctx, "送信済み");
    return;
  }

  const recipients = await loadRecipients(client, input.orgId);
  if (recipients.length === 0) {
    // 宛先が無いのは設定の問題。確保を残すと、宛先を足しても二度と送られない
    await releaseNotification(client, claim.id);
    skip(ctx, "宛先が登録されていません");
    return;
  }

  let delivered = 0;
  for (const to of recipients) {
    try {
      await sendEmail({
        to,
        subject: input.email.subject,
        text: input.email.text,
        from: buildFromHeader(SENDER_NAME, serviceFromAddress()),
      });
      delivered++;
    } catch (err) {
      console.error(`[notify_instant] 送信に失敗しました（${input.dedupeKey} to=${to}）`, err);
    }
  }

  if (delivered === 0) {
    // 送っていないのに送った記録を残さない。期限の通知でそれが起きると参加できなくなる
    await releaseNotification(client, claim.id);
    ctx.summary.failed++;
    return;
  }

  await recordRecipients(client, claim.id, delivered);
  ctx.summary.sent++;
  ctx.summary.byKind[input.kind] = (ctx.summary.byKind[input.kind] ?? 0) + 1;
}
