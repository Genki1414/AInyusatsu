// ゴールドセットでAI解析の精度を測るCLI（タスク2-6）。
//
// 使い方:
//   pnpm --filter worker goldset:template        記入用のファイルを作る（既定20件）
//   pnpm --filter worker goldset:template -- 30  件数を変える場合
//   pnpm --filter worker goldset:measure         記入済みのファイルで測る
//
// 参照：docs/reference/精度の測りかた.md

import { measureGoldset, writeGoldsetTemplate } from "../jobs/goldset";
import { GOLDSET_TARGETS, type Accuracy, type F1Score } from "@ai-nyusatsu-bu/domain";
import { cliArgs, CliUsageError, rejectExtraArgs, requirePositiveInt, runCli } from "./_args";

const USAGE = "pnpm --filter worker goldset:template [件数] / goldset:measure";
const DEFAULT_LIMIT = 20;
const GOLDSET_PATH = "goldset/goldset.json";

function percent(value: number | null): string {
  return value === null ? "測っていません" : `${(value * 100).toFixed(1)}%`;
}

function judge(meets: boolean | null): string {
  if (meets === null) return "—";
  return meets ? "届いている" : "届いていない";
}

function showAccuracy(label: string, accuracy: Accuracy, target: number, meets: boolean | null): void {
  const detail = accuracy.total === 0 ? "" : `（${accuracy.correct}/${accuracy.total}）`;
  console.log(`  ${label.padEnd(10, "　")} ${percent(accuracy.rate)}${detail}  目安 ${percent(target)}  ${judge(meets)}`);
}

function showF1(score: F1Score, meets: boolean | null): void {
  console.log(
    `  ${"業種F1".padEnd(10, "　")} ${score.f1 === null ? "測っていません" : score.f1.toFixed(2)}` +
      `  目安 ${GOLDSET_TARGETS.tradeF1.toFixed(2)}  ${judge(meets)}`,
  );
  if (score.f1 !== null) {
    console.log(`             （適合 ${percent(score.precision)} / 再現 ${percent(score.recall)}）`);
  }
}

async function main() {
  // モードはpackage.jsonのスクリプトが渡す。環境変数にするとWindowsで書き方が変わるため引数にした
  const [mode, ...rest] = cliArgs();
  // `pnpm ... goldset:template -- 30` の "--" を取り除く
  const args = rest[0] === "--" ? rest.slice(1) : rest;

  if (mode === "template") {
    rejectExtraArgs(args, 1, USAGE);
    const limit = args[0] === undefined ? DEFAULT_LIMIT : requirePositiveInt(args[0], "件数");

    const result = await writeGoldsetTemplate(GOLDSET_PATH, limit);
    console.log(`${result.path} に${result.tenders}件ぶんを書き出しました（解析の新しい順）。`);
    console.log("");
    console.log("各案件に「保存されている値」と、その根拠になった引用・出典が入っています。");
    console.log("引用を読んで、合っているかどうかを判断してください。原文を開く必要はほとんどありません。");
    console.log("値は製品が実際に使っているもの（DBの値）です。日時は日本時間で出しています。");
    console.log("");
    console.log("1. 確認した項目を checked に書く（合っていた項目も含めて）");
    console.log('     "checked": ["期限"]            期限3項目を確認した');
    console.log('     "checked": ["期限", "業種"]    まとめて指定できる');
    console.log('     "checked": ["すべて"]          全項目を確認した');
    console.log("");
    console.log("2. 間違えていた項目だけ expected に正しい値を書く");
    console.log('     "expected": { "submitDeadline": "2026-09-25T17:00:00+09:00" }');
    console.log("");
    console.log("合っていた項目は何も書かなくて構いません。");
    console.log("checked が空の案件は1項目も測りません（見ていないものを正解に数えないため）。");
    console.log("「引用なし＝未確認」と出ている項目は、原文で確かめてください。");
    console.log("");
    console.log("「注意」が付いている項目は、AIの読み取りと保存されている値がずれています。");
    console.log("`pnpm --filter worker deadlines:repair` で入れ直せます（既定は下見）。");
    return;
  }

  if (mode !== "measure") {
    throw new CliUsageError(`使い方: ${USAGE}`);
  }

  rejectExtraArgs(args, 0, USAGE);
  const report = await measureGoldset(GOLDSET_PATH);

  console.log(`${report.tenders}件を突き合わせました。`);
  console.log("");
  console.log("■ 精度");
  showAccuracy("期限", report.deadlines, GOLDSET_TARGETS.deadlineAccuracy, report.meets.deadlines);
  showAccuracy("参加資格", report.qualification, GOLDSET_TARGETS.qualificationAccuracy, report.meets.qualification);
  showF1(report.trades, report.meets.trades);

  const mistakes = report.results.filter((r) => r.mistakes.length > 0);
  if (mistakes.length > 0) {
    console.log("");
    console.log("■ 間違えたところ");
    for (const result of mistakes) {
      console.log(`  ${result.tenderName}`);
      for (const mistake of result.mistakes) {
        console.log(`    ${mistake.field}：正 ${mistake.expected} ／ AI ${mistake.actual}`);
      }
    }
  }

  if (report.skipped.length > 0) {
    console.log("");
    console.log("■ 突き合わせられなかったもの");
    for (const reason of report.skipped) console.log(`  ・${reason}`);
  }

  console.log("");
  if (report.meets.deadlines === false) {
    // 期限の誤りは失格に直結する（CLAUDE.md 最重要の前提5）
    console.log("期限が目安に届いていません。本番で回す前に、間違えた案件の原文を確認してください。");
  }
}

runCli(main);
