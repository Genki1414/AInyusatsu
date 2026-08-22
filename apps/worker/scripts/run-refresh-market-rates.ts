// market_rates（相場の集計キャッシュ）の再計算ジョブをローカルから実行するCLI。
// 使い方: pnpm --filter worker exec tsx scripts/run-refresh-market-rates.ts [対象月数]
//   対象月数を省略すると既定の24か月分（awardsの直近データ）を対象にする。
// 参照：docs/reference/ローカル実行手順.md

import { refreshMarketRates } from "../jobs/refresh_market_rates";
import { cliArgs, rejectExtraArgs, requirePositiveInt, runCli } from "./_args";

const USAGE = "pnpm --filter worker market-rates:refresh [-- 対象月数]";

async function main() {
  const args = cliArgs();
  rejectExtraArgs(args, 1, USAGE);
  const periodMonths = args[0] ? requirePositiveInt(args[0], "対象月数") : undefined;
  console.log(`market_ratesを再計算します（対象=${periodMonths ?? 24}か月）`);
  const outcome = await refreshMarketRates(periodMonths);
  console.log(JSON.stringify(outcome, null, 2));
}

runCli(main);
