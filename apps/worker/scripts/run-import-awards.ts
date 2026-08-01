// 落札実績オープンデータの取り込みジョブをローカルから実行するCLI。
// 使い方:
//   全件（年度ごと）: pnpm --filter worker exec tsx scripts/run-import-awards.ts full [西暦年]
//     年を省略すると実行時点の年（JST）を対象にする。
//   差分（日ごと）  : pnpm --filter worker exec tsx scripts/run-import-awards.ts diff [YYYY-MM-DD]
//     日付を省略すると前日（JST）を対象にする。対象日のファイルが無ければ no_data で正常終了する。
// 参照：docs/reference/ローカル実行手順.md

import { runDiffImport, runFullImport } from "../jobs/import_awards";
import { yesterdayJst } from "./_date";

function currentYearJst(): number {
  const nowJst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return nowJst.getUTCFullYear();
}

async function main() {
  const mode = process.argv[2];
  if (mode !== "full" && mode !== "diff") {
    console.error("使い方: run-import-awards.ts <full|diff> [年 または YYYY-MM-DD]");
    process.exitCode = 1;
    return;
  }

  if (mode === "full") {
    const year = process.argv[3] ? Number(process.argv[3]) : currentYearJst();
    console.log(`落札実績オープンデータ（全件・${year}年）を取り込みます`);
    const outcome = await runFullImport(year);
    console.log(JSON.stringify(outcome, null, 2));
    if (outcome.status === "failed") process.exitCode = 1;
    return;
  }

  const dateIso = process.argv[3] || yesterdayJst();
  console.log(`落札実績オープンデータ（差分・${dateIso}）を取り込みます`);
  const outcome = await runDiffImport(new Date(`${dateIso}T00:00:00Z`));
  console.log(JSON.stringify(outcome, null, 2));
  if (outcome.status === "failed") process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
