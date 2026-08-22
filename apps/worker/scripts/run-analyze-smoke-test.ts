// AI解析（タスク2-3）の動作確認用スモークテスト。
// 実際に保存されている資料（tender_documents.extracted_text）を1件使って、
// プロンプト「基本情報と期限」をClaude APIに1回投げ、Zodスキーマを通るか確認する。
//
// 事前条件：
//   - タスク2-2（資料のテキスト抽出）で tender_documents.extracted_text が
//     埋まっている資料が1件以上あること（pnpm --filter worker documents:extract-text を先に実行）
//   - apps/worker/.env.local に ANTHROPIC_API_KEY を設定していること
//
// 使い方: pnpm --filter worker ai:smoke-test [tender_documents.id]
//   IDを省略すると、extracted_textが入っている資料のうち最初の1件を対象にする。

import { createServiceClient } from "@ai-nyusatsu-bu/db";
import { analyzeBasicInfo, callClaude } from "@ai-nyusatsu-bu/ai";
import { cliArgs, rejectExtraArgs, runCli } from "./_args";

const USAGE = "pnpm --filter worker ai:smoke-test [-- <tender_documents.id>]";

async function main() {
  const client = createServiceClient();
  const args = cliArgs();
  rejectExtraArgs(args, 1, USAGE);
  const documentId = args[0];

  const query = client
    .from("tender_documents")
    .select("id, kind, extracted_text, tender_id")
    .not("extracted_text", "is", null);

  const { data: doc, error } = documentId
    ? await query.eq("id", documentId).single()
    : await query.limit(1).single();

  if (error || !doc) {
    console.error(
      "対象の資料が見つかりませんでした。先に `pnpm --filter worker documents:extract-text` で" +
        "テキスト抽出を実行してください。",
      error,
    );
    process.exitCode = 1;
    return;
  }

  const { data: tender, error: tenderError } = await client
    .from("tenders")
    .select("agency_id, notice_no, procurement, agencies(name)")
    .eq("id", doc.tender_id)
    .single();
  if (tenderError || !tender) {
    console.error("案件情報の取得に失敗しました", tenderError);
    process.exitCode = 1;
    return;
  }

  // Supabaseのjoin結果はagencies:{name}|{name}[]のどちらの形でも来うるため吸収する。
  const agencyRow = tender.agencies as unknown;
  const agencyName = Array.isArray(agencyRow) ? (agencyRow[0]?.name ?? "") : ((agencyRow as { name?: string })?.name ?? "");

  console.log(`対象資料: ${doc.id}（${doc.kind}、案件 ${doc.tender_id}）`);
  console.log("Claude APIを呼び出します（プロンプト: 基本情報と期限）...");

  const result = await analyzeBasicInfo({
    meta: {
      agencyName,
      noticeNo: tender.notice_no ?? "",
      procurement: tender.procurement ?? "",
    },
    documents: [{ kind: doc.kind, text: doc.extracted_text }],
    callModel: callClaude,
    onInvalid: (event) => console.error("スキーマ不一致（再試行します）", event),
  });

  console.log(JSON.stringify(result, null, 2));
}

runCli(main);
