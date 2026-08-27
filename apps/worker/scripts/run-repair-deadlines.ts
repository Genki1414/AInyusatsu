// 保存済みの期限を、解析結果の生出力から入れ直すCLI。
//
// 使い方:
//   pnpm --filter worker deadlines:repair            下見（何も書き換えない）
//   pnpm --filter worker deadlines:repair -- apply   実際に入れ直す
//
// 期限の誤りは失格に直結する（CLAUDE.md 最重要の前提5）ので、既定は下見。

import { repairDeadlines } from "../jobs/repair_deadlines";
import { cliArgs, CliUsageError, rejectExtraArgs, runCli } from "./_args";

const USAGE = "pnpm --filter worker deadlines:repair [apply]";

async function main() {
  const args = cliArgs();
  rejectExtraArgs(args, 1, USAGE);
  const mode = args[0];
  if (mode !== undefined && mode !== "apply") {
    throw new CliUsageError(`使い方: ${USAGE}（受け取った値: ${JSON.stringify(mode)}）`);
  }
  const apply = mode === "apply";

  const result = await repairDeadlines(apply);

  if (result.checked === 0) {
    console.log("解析済みの案件がありません。");
    return;
  }
  const showUnexplained = () => {
    if (result.unexplained.length === 0) return;
    console.log("");
    console.log(`■ 違いはあるが、この不具合とは言えないもの（${result.unexplained.length}項目・書き換えません）`);
    console.log("  コネクタが取得した確定値が入っている可能性があります。原文と照らして判断してください。");
    for (const item of result.unexplained) {
      console.log(`  ${item.tenderName}`);
      console.log(`    ${item.label}：保存値 ${item.stored} ／ 解析結果 ${item.fromAnalysis}`);
    }
  };

  if (result.diffs.length === 0) {
    console.log(`${result.checked}件を確認しました。タイムゾーンでずれている期限はありません。`);
    showUnexplained();
    return;
  }

  console.log(`${result.checked}件のうち、${result.diffs.length}項目がタイムゾーンでずれています（日本時間で表示）。`);
  console.log("");
  for (const diff of result.diffs) {
    console.log(`  ${diff.tenderName}`);
    console.log(`    ${diff.label}：いま ${diff.stored} → 入れ直すと ${diff.fixed}`);
  }
  showUnexplained();
  console.log("");

  if (!apply) {
    console.log("下見です。何も書き換えていません。");
    console.log("入れ直すには: pnpm --filter worker deadlines:repair -- apply");
    return;
  }
  console.log(`${result.applied}件を入れ直しました。`);
}

runCli(main);
