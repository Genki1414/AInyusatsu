// 落札実績オープンデータの取り込みジョブをローカルから実行するCLI。
// 使い方:
//   全件（年度ごと）: pnpm --filter worker exec tsx scripts/run-import-awards.ts full [西暦年]
//     年を省略すると実行時点の年（JST）を対象にする。
//   差分（日ごと）  : pnpm --filter worker exec tsx scripts/run-import-awards.ts diff [YYYY-MM-DD]
//     日付を省略すると前日（JST）を対象にする。対象日のファイルが無ければ no_data で正常終了する。
// 参照：docs/reference/ローカル実行手順.md

import { runDiffImport, runFullImport } from "../jobs/import_awards";
import { CliUsageError, cliArgs, rejectExtraArgs, requireDateIso, requirePositiveInt, runCli } from "./_args";
import { yesterdayJst } from "./_date";

const USAGE = "pnpm --filter worker awards:import -- <full 西暦年 | diff YYYY-MM-DD>";

function currentYearJst(): number {
  const nowJst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return nowJst.getUTCFullYear();
}

async function main() {
  const args = cliArgs();
  rejectExtraArgs(args, 2, USAGE);
  const [mode, arg] = args;
  if (mode !== "full" && mode !== "diff") {
    throw new CliUsageError(`full か diff を指定してください（受け取った値: ${JSON.stringify(mode ?? "")}）\n使い方: ${USAGE}`);
  }

  if (mode === "full") {
    const year = arg ? requirePositiveInt(arg, "西暦年") : currentYearJst();
    console.log(`落札実績オープンデータ（全件・${year}年）を取り込みます`);
    const outcome = await runFullImport(year);
    console.log(JSON.stringify(outcome, null, 2));
    if (outcome.status === "failed") process.exitCode = 1;
    return;
  }

  const dateIso = arg ? requireDateIso(arg, "対象日") : yesterdayJst();
  console.log(`落札実績オープンデータ（差分・${dateIso}）を取り込みます`);
  const outcome = await runDiffImport(new Date(`${dateIso}T00:00:00Z`));
  console.log(JSON.stringify(outcome, null, 2));
  if (outcome.status === "failed") process.exitCode = 1;
}

runCli(main);
