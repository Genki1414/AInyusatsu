// KKJ（官公需情報ポータル）同期ジョブをローカルから実行するCLI。
// 使い方: pnpm --filter worker exec tsx scripts/run-kkj-sync.ts [YYYY-MM-DD]
//   日付を省略すると前日（JST）を対象にする。
// 参照：docs/reference/ローカル実行手順.md

import { runKkjSync } from "../jobs/kkj_sync";
import { cliArgs, rejectExtraArgs, requireDateIso, runCli } from "./_args";
import { yesterdayJst } from "./_date";

const USAGE = "pnpm --filter worker kkj:sync [-- YYYY-MM-DD]";

async function main() {
  const args = cliArgs();
  rejectExtraArgs(args, 1, USAGE);
  const dateIso = args[0] ? requireDateIso(args[0], "公告日") : yesterdayJst();
  console.log(`KKJ同期を実行します（公告日=${dateIso}）`);
  const summary = await runKkjSync(dateIso);
  console.log(JSON.stringify(summary, null, 2));
  if (summary.status !== "completed") process.exitCode = 1;
}

runCli(main);
