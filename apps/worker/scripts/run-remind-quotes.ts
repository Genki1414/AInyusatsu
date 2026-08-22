// 見積依頼の自動催促（remind ジョブ、タスク4-4）をローカルから実行するCLI。
// 使い方: pnpm --filter worker quotes:remind
// 参照：docs/reference/ローカル実行手順.md

import { runQuoteReminders } from "../jobs/remind_quotes";
import { cliArgs, rejectExtraArgs, runCli } from "./_args";

const USAGE = "pnpm --filter worker quotes:remind";

async function main() {
  rejectExtraArgs(cliArgs(), 0, USAGE);

  console.log("回答期限の24時間前を切った未回答の見積依頼へ、催促メールを送ります");
  const result = await runQuoteReminders();
  console.log(JSON.stringify(result, null, 2));
}

runCli(main);
