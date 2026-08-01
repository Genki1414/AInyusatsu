// 調達ポータル（GEPS）の巡回ジョブをローカルから実行するCLI。
// 使い方: pnpm --filter worker exec tsx scripts/run-geps-crawl.ts [YYYY-MM-DD]
//   日付を省略すると前日（JST）を対象にする。物品・役務の両分類を順に巡回する。
// 事前にブラウザが必要: pnpm --filter worker exec playwright install chromium
// 参照：docs/reference/ローカル実行手順.md

import { runDailyGepsCrawl } from "../jobs/crawl_geps";
import { cliArgs } from "./_args";
import { yesterdayJst } from "./_date";

async function main() {
  const dateIso = cliArgs()[0] || yesterdayJst();
  console.log(`調達ポータルの巡回を実行します（公開開始日=${dateIso}）`);
  const summaries = await runDailyGepsCrawl(dateIso);
  console.log(JSON.stringify(summaries, null, 2));
  if (summaries.some((s) => s.status === "failed")) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
