// 見積依頼の自動催促（タスク4-4）。
// 回答期限の24時間前を切っても未回答の協力会社へ、1回だけ催促メールを送る。
//
// 判定（送るか／送らないか）は packages/domain の shouldRemind に置き、ここでは
// DBの読み書きとメール送信だけを行う。
//
// 催促は1回だけにする（quotes.reminded_at で記録）。繰り返し送ると迷惑メール扱いになり、
// 本来の依頼まで届かなくなる。期限を過ぎたものにも送らない（今から間に合わないため）。

import { createServiceClient } from "@ai-nyusatsu-bu/db";
import { sendEmail, serviceFromAddress } from "@ai-nyusatsu-bu/notifications";
import {
  buildQuoteReminderEmail,
  resolveSenderIdentity,
  shouldRemind,
  type SenderIdentity,
  type SkipReason,
} from "@ai-nyusatsu-bu/domain";

export type RemindQuotesSummary = {
  /** 判定した見積の件数 */
  checked: number;
  /** 催促を送れた件数 */
  reminded: number;
  /** 送ろうとして失敗した件数（要対応） */
  failed: number;
  /** 送らなかった理由の内訳 */
  skipped: Record<string, number>;
};

type QuoteRow = {
  id: string;
  replied_at: string | null;
  declined: boolean;
  reminded_at: string | null;
  response_token: string;
  partners: { name: string; email: string | null } | { name: string; email: string | null }[] | null;
  quote_requests: QuoteRequestRef | QuoteRequestRef[] | null;
};

type QuoteRequestRef = {
  org_id: string;
  trade: string;
  due_at: string | null;
  tenders: { name: string } | { name: string }[] | null;
  organizations: { name: string } | { name: string }[] | null;
};

function one<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function jst(iso: string): string {
  return new Date(iso).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
}

function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3001").replace(/\/+$/, "");
}

/** 協力会社への返信先に使う、依頼元組織のメールアドレスを1件取得する。 */
async function firstOrgEmail(client: ReturnType<typeof createServiceClient>, orgId: string): Promise<string | null> {
  const { data, error } = await client
    .from("users")
    .select("email, role")
    .eq("org_id", orgId)
    .order("role") // owner が member より先に来る
    .limit(1)
    .maybeSingle<{ email: string; role: string }>();
  if (error) {
    console.error(`[remind_quotes] 返信先ユーザーの取得に失敗しました（org=${orgId}）: ${error.message}`);
    return null;
  }
  return data?.email ?? null;
}

/**
 * 差出人と返信先を、依頼元の顧客企業に向けて決める。
 * 協力会社にとっての取引相手はサービスの運営会社ではないため、ここを取り違えると
 * 受け取った側が誰からの催促か分からなくなる。
 */
async function senderFor(
  client: ReturnType<typeof createServiceClient>,
  orgId: string,
  orgName: string,
): Promise<SenderIdentity> {
  const { data } = await client
    .from("organizations")
    .select("reply_to")
    .eq("id", orgId)
    .maybeSingle<{ reply_to: string | null }>();
  return resolveSenderIdentity({
    orgName,
    serviceAddress: serviceFromAddress(),
    configuredReplyTo: data?.reply_to ?? null,
    ownerEmail: await firstOrgEmail(client, orgId),
  });
}

/**
 * 催促の対象を探して送る。
 * `now` を引数にしているのは、再現できる形でテストできるようにするため。
 */
export async function runQuoteReminders(now: Date = new Date()): Promise<RemindQuotesSummary> {
  const client = createServiceClient();

  // 期限が近いものだけを引く。全件を持ってきて絞ると、案件が増えたときに無駄が大きい。
  const windowEnd = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

  const { data: rows, error } = await client
    .from("quotes")
    .select(
      "id, replied_at, declined, reminded_at, response_token, partners(name, email), quote_requests!inner(org_id, trade, due_at, tenders(name), organizations(name))",
    )
    .is("replied_at", null)
    .is("reminded_at", null)
    .eq("declined", false)
    .not("quote_requests.due_at", "is", null)
    .gt("quote_requests.due_at", now.toISOString())
    .lte("quote_requests.due_at", windowEnd)
    .returns<QuoteRow[]>();
  if (error) throw new Error(`催促対象の取得に失敗しました: ${error.message}`);

  const summary: RemindQuotesSummary = { checked: 0, reminded: 0, failed: 0, skipped: {} };
  const skip = (reason: SkipReason | string) => {
    summary.skipped[reason] = (summary.skipped[reason] ?? 0) + 1;
  };

  for (const row of rows ?? []) {
    summary.checked++;
    const partner = one(row.partners);
    const request = one(row.quote_requests);

    // SQLで絞ってはいるが、判定の正はドメイン側に置く（境界の扱いを1か所にまとめる）。
    const decision = shouldRemind(
      {
        repliedAt: row.replied_at,
        declined: row.declined,
        remindedAt: row.reminded_at,
        dueAt: request?.due_at ?? null,
        partnerEmail: partner?.email ?? null,
      },
      now,
    );
    if (!decision.remind) {
      skip(decision.reason);
      continue;
    }
    const dueAt = request?.due_at;
    if (!request || !dueAt || !partner?.email) {
      // shouldRemind が通った以上ここには来ないが、型の絞り込みのために残す。
      skip("依頼情報が取得できない");
      continue;
    }

    const orgName = one(request.organizations)?.name ?? "発注元企業";
    const sender = await senderFor(client, request.org_id, orgName);
    const { subject, body } = buildQuoteReminderEmail({
      partnerName: partner.name,
      senderOrgName: orgName,
      // 協力会社が返信できる連絡先。署名にも同じアドレスを載せる
      senderContactEmail: sender.replyTo,
      tenderName: one(request.tenders)?.name ?? "案件名未確認",
      trade: request.trade,
      dueAtLabel: jst(dueAt),
      responseUrl: `${appUrl()}/q/${row.response_token}`,
    });

    try {
      await sendEmail({ to: partner.email, subject, text: body, from: sender.from, replyTo: sender.replyTo });
    } catch (err) {
      // 1件の失敗で他の催促を止めない。失敗は握りつぶさずログに残す（CLAUDE.md）。
      summary.failed++;
      console.error(`[remind_quotes] 催促メールの送信に失敗しました（quote=${row.id}）`, err);
      continue;
    }

    // 送れたものだけ記録する。ここで失敗すると次回また送ってしまうため、必ず理由を残す。
    const { error: stampError } = await client
      .from("quotes")
      .update({ reminded_at: new Date().toISOString() })
      .eq("id", row.id);
    if (stampError) {
      summary.failed++;
      console.error(`[remind_quotes] 催促日時の記録に失敗しました（quote=${row.id}）: ${stampError.message}`);
      continue;
    }

    summary.reminded++;
  }

  return summary;
}
