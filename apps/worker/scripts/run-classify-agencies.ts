// 発注機関を「国 / 自治体 / 独立行政法人等 / 不明」に分類するCLI。
//
// 使い方:
//   pnpm --filter worker agencies:classify           下見だけ（何も書き換えない）
//   pnpm --filter worker agencies:classify apply     分類を保存する
//
// 参照：docs/reference/ローカル実行手順.md

import { includeIncorporatedFromEnv, runClassifyAgencies } from "../jobs/classify_agencies";
import { cliArgs, CliUsageError, rejectExtraArgs, runCli } from "./_args";

const USAGE = "pnpm --filter worker agencies:classify [apply]";
const DAYS = 30;

async function main() {
  const args = cliArgs();
  rejectExtraArgs(args, 1, USAGE);

  const mode = args[0] ?? "dry-run";
  if (mode !== "dry-run" && mode !== "apply") {
    throw new CliUsageError(`指定できるのは "apply" だけです（受け取った値: ${JSON.stringify(mode)}）\n使い方: ${USAGE}`);
  }
  const apply = mode === "apply";

  console.log(
    apply
      ? "発注機関を分類して保存します"
      : "発注機関を分類します（下見のみ。保存するには最後に apply を付けてください）",
  );

  const result = await runClassifyAgencies({ days: DAYS, apply });

  console.log("");
  console.log("■ 発注機関の分類");
  for (const [scope, count] of Object.entries(result.agencies)) {
    console.log(`  ${scope.padEnd(8, "　")} ${String(count).padStart(5)}機関`);
  }

  if (result.unknownNames.length > 0) {
    console.log("");
    console.log("■ 分類できなかった機関（判定を直す手がかり）");
    for (const name of result.unknownNames) console.log(`  ・${name}`);
  }

  console.log("");
  console.log(`■ 直近${result.days}日の案件（${result.tenderTotal}件／公告日${result.activeDays}日ぶん）`);
  for (const [verdict, count] of Object.entries(result.tenders)) {
    const share = result.tenderTotal === 0 ? 0 : Math.round((count / result.tenderTotal) * 100);
    console.log(`  ${verdict.padEnd(6, "　")} ${String(count).padStart(5)}件（${share}%）`);
  }

  const reasons = Object.entries(result.reasons).sort((a, b) => b[1] - a[1]);
  if (reasons.length > 0) {
    console.log("");
    console.log("■ 対象にしない理由");
    for (const [reason, count] of reasons) console.log(`  ${String(count).padStart(5)}件  ${reason}`);
  }

  console.log("");
  console.log("■ AI解析の見込み（実測 約69円/件）");
  console.log(
    `  独立行政法人等：${includeIncorporatedFromEnv() ? "対象に含める" : "対象外"}` +
      "（INCLUDE_INCORPORATED_AGENCIES=true で含められます）",
  );
  console.log(`  対象 ${result.targetPerDay.toFixed(1)}件/日 → 月 約${result.estimatedMonthlyYen.toLocaleString("ja-JP")}円`);
  console.log("  ※ 実際に解析されるのは資料が取れた案件だけなので、これは上限の目安です");

  console.log("");
  if (apply) {
    console.log(`${result.updated}機関の分類を保存しました`);
  } else {
    console.log("保存するには: pnpm --filter worker agencies:classify apply");
  }
}

runCli(main);
