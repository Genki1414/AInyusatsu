// 発注機関の欠測チェック（実装仕様書_v1.md §5 coverage_check）をローカルから実行するCLI。
// 使い方: pnpm --filter worker coverage:check
// 参照：docs/reference/ローカル実行手順.md

import { runCoverageCheck } from "../jobs/coverage_check";
import { cliArgs, rejectExtraArgs, runCli } from "./_args";

const USAGE = "pnpm --filter worker coverage:check";

async function main() {
  rejectExtraArgs(cliArgs(), 0, USAGE);

  console.log("発注機関ごとに、想定頻度に対して取得できているかを確かめます");
  const result = await runCoverageCheck();
  console.log(JSON.stringify(result, null, 2));
}

runCli(main);
