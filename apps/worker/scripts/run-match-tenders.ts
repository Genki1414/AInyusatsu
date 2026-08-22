// 提案の作成（match ジョブ、タスク3-2）をローカルから実行するCLI。
// 使い方: pnpm --filter worker match:tenders
// 参照：docs/reference/ローカル実行手順.md

import { runMatchTenders } from "../jobs/match_tenders";
import { cliArgs, rejectExtraArgs, runCli } from "./_args";

const USAGE = "pnpm --filter worker match:tenders";

async function main() {
  rejectExtraArgs(cliArgs(), 0, USAGE);

  console.log("公開中の案件を条件セットごとに採点し、proposalsへ保存します");
  const result = await runMatchTenders();
  console.log(JSON.stringify(result, null, 2));
}

runCli(main);
