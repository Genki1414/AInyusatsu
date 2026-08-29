// 本部への異常通知（リリース準備）。
//
// 【なぜ要るか】
// docs/本番環境_推奨構成.md「監視で必ず入れる3つ」にこう書いてある。
//   「コネクタのセレクタが空振り（LAYOUT_CHANGED）→ 即通知。
//     これを放置するとサービスが静かに死にます」
// これまで失敗はログに出るだけで、誰にも届いていなかった。/admin を開けば見えるが、
// 毎朝開く前提は現実的ではない。顧客に「案件が来ない」と言われて初めて気づく形だった。
//
// 【異常が無くても毎朝送る】
// 「異常があるときだけ送る」にすると、ワーカーごと止まったときに何も届かない。
// 静かに死ぬのを防ぐのが目的なのに、いちばん危ない壊れ方を見逃す。
// 件名に状態を入れて毎朝1通送り、**届かない日があること自体を異常の合図**にする。
//
// 【顧客には送らない】
// 宛先は ADMIN_EMAILS（運営画面に入れる人と同じ）。
// 組織をまたいだ失敗の一覧なので、顧客に見せるものではない。

import { createServiceClient } from "@ai-nyusatsu-bu/db";
import { sendEmail } from "@ai-nyusatsu-bu/notifications";
import {
  adminEmails,
  buildOpsAlert,
  groupCollectionIssues,
  stalledIssues,
  type CollectionIssue,
} from "@ai-nyusatsu-bu/domain";
import { loadCoverage } from "./coverage_check";

type Supabase = ReturnType<typeof createServiceClient>;

type TenderRow = {
  id: string;
  name: string;
  documents_failure_code: string | null;
  documents_failure_reason: string | null;
  documents_checked_at: string | null;
  failure_code: string | null;
  failure_reason: string | null;
  updated_at: string | null;
  agencies: { name: string } | { name: string }[] | null;
};

function one<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

/**
 * 失敗の一覧。/admin の「収集キュー」と同じ引き方にする。
 * 画面と通知で件数が食い違うと、どちらを信じるか分からなくなる。
 */
async function loadIssues(client: Supabase): Promise<CollectionIssue[]> {
  const { data, error } = await client
    .from("tenders")
    .select(
      "id, name, documents_failure_code, documents_failure_reason, documents_checked_at, failure_code, failure_reason, updated_at, agencies(name)",
    )
    .or("documents_failure_code.not.is.null,failure_code.not.is.null")
    .neq("collect_status", "終了")
    .order("updated_at", { ascending: false })
    .limit(500)
    .returns<TenderRow[]>();
  if (error) throw new Error(`収集キューの取得に失敗しました: ${error.message}`);

  const issues: CollectionIssue[] = [];
  for (const row of data ?? []) {
    const agencyName = one(row.agencies)?.name ?? "（機関不明）";
    if (row.documents_failure_code) {
      issues.push({
        tenderId: row.id,
        tenderName: row.name,
        agencyName,
        failureCode: row.documents_failure_code,
        failureReason: row.documents_failure_reason,
        at: row.documents_checked_at ?? row.updated_at,
      });
    }
    if (row.failure_code) {
      issues.push({
        tenderId: row.id,
        tenderName: row.name,
        agencyName,
        failureCode: row.failure_code,
        failureReason: row.failure_reason,
        at: row.updated_at,
      });
    }
  }
  return issues;
}

/**
 * 直近24時間に失敗したジョブの名前。
 *
 * pg-boss は失敗したジョブを job テーブルに残す。スキーマ名は pg-boss の版で
 * 変わることがあり、読めなくても通知そのものは送りたいので、
 * 読めなければ空にしてログに残す（ここで例外を投げると通知が届かなくなる）。
 */
export async function recentFailedJobs(client: Supabase, now: Date = new Date()): Promise<string[]> {
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await client
    .schema("pgboss")
    .from("job")
    .select("name")
    .eq("state", "failed")
    .gte("created_on", since)
    .limit(200)
    .returns<{ name: string }[]>();
  if (error) {
    console.warn(`[notify_ops] 失敗したジョブを読めませんでした（通知は続けます）: ${error.message}`);
    return [];
  }
  return [...new Set((data ?? []).map((row) => row.name))].sort();
}

export type OpsNotifyResult = {
  /** 送れた宛先の数 */
  sent: number;
  /** 対応が必要な件数 */
  attention: number;
};

export async function runNotifyOps(now: Date = new Date()): Promise<OpsNotifyResult> {
  const recipients = adminEmails(process.env.ADMIN_EMAILS);
  if (recipients.length === 0) {
    // 設定漏れで黙って何も届かないのがいちばん困る。ログには必ず残す
    console.error("[notify_ops] ADMIN_EMAILS が設定されていません。異常通知の宛先がありません");
    return { sent: 0, attention: 0 };
  }

  const client = createServiceClient();
  const [issues, coverage, failedJobs] = await Promise.all([
    loadIssues(client),
    loadCoverage(client, now),
    recentFailedJobs(client, now),
  ]);

  const groups = groupCollectionIssues(issues);
  const alert = buildOpsAlert({
    groups,
    stalled: stalledIssues(groups, now).length,
    coverage: {
      checked: coverage.checked,
      healthy: coverage.healthy,
      missing: coverage.missing.length,
      delayed: coverage.delayed.length,
    },
    failedJobs,
    dateLabel: now.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }),
  });

  let sent = 0;
  for (const to of recipients) {
    try {
      await sendEmail({ to, subject: alert.subject, text: alert.body });
      sent += 1;
    } catch (err) {
      // 1つの宛先で失敗しても他へは送る。全部落ちたときに気づけるよう件数を返す
      console.error(`[notify_ops] 送信に失敗しました（${to}）`, err);
    }
  }
  if (sent === 0) {
    console.error("[notify_ops] すべての宛先で送信に失敗しました。異常通知が誰にも届いていません");
  }

  console.log(`[notify_ops] ${alert.subject}（宛先${sent}/${recipients.length}）`);
  return { sent, attention: alert.attention };
}
