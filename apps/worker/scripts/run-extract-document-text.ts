// 資料のテキスト抽出ジョブをローカルから実行するCLI。
// 使い方: pnpm --filter worker exec tsx scripts/run-extract-document-text.ts [件数]
//   件数を省略すると50件を対象にする。
// 参照：docs/reference/ローカル実行手順.md

import { runExtractPendingDocuments } from "../jobs/extract_document_text";
import { cliArgs } from "./_args";

async function main() {
  const arg = cliArgs()[0];
  const limit = arg ? Number(arg) : 50;
  console.log(`資料のテキスト抽出を実行します（最大${limit}件）`);
  const summary = await runExtractPendingDocuments(limit);
  console.log(JSON.stringify(summary, null, 2));
  if (summary.failed > 0 && summary.succeeded === 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
