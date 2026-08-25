// 受信済みの返信を、保存してある元データ（raw）から読み直すCLI。
//
// 使い方:
//   pnpm --filter worker inbound:reparse           下見だけ（何も書き換えない）
//   pnpm --filter worker inbound:reparse apply     読み直した内容を書き戻す
//
// 本文が空・添付ゼロで入ってしまった返信を、協力会社に送り直してもらわずに直すための道具。
// 参照：docs/reference/ローカル実行手順.md

import { runReparseInbound } from "../jobs/reparse_inbound";
import { cliArgs, CliUsageError, rejectExtraArgs, runCli } from "./_args";

const USAGE = "pnpm --filter worker inbound:reparse [apply]";
const LIMIT = 20;

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
      ? "受信済みの返信を読み直して書き戻します（金額は候補のまま。quotes.amount には書きません）"
      : "受信済みの返信を読み直します（下見のみ。書き戻すには最後に apply を付けてください）",
  );

  const result = await runReparseInbound({ limit: LIMIT, onlyIncomplete: true, apply });

  if (result.examined === 0) {
    console.log("本文と添付が両方そろっていない返信はありませんでした。読み直す対象はありません");
    return;
  }

  for (const row of result.rows) {
    console.log("");
    console.log(`── ${row.receivedAt}（${row.id}）`);
    console.log(`   本文       : ${row.bodyPath ?? "見つからず"}（${row.bodyLength}文字）`);
    console.log(`   添付       : ${row.attachmentsPath ?? "見つからず"}（読めたもの ${row.attachmentCount}件 / 保存済み ${row.storedCount}件）`);
    console.log(`   金額の候補 : ${row.amount === null ? "なし" : `${row.amount.toLocaleString("ja-JP")}円`}`);
    console.log(`   見積       : ${row.matchedQuoteId ?? "特定できず"}${row.newlyMatched ? "（今回特定）" : ""}`);
    for (const note of row.notes) console.log(`   ※ ${note}`);

    // 読めなかったときだけ、届いたJSONの形を出す（項目名を足すための材料）
    if (row.bodyPath === null || row.attachmentsPath === null) {
      console.log("   届いたJSONの形（項目名と型だけ。中身は出しません）:");
      for (const line of row.shape) console.log(`     ${line}`);
    }
  }

  console.log("");
  console.log(`対象 ${result.examined}件 / 書き戻し ${result.updated}件`);
  if (!apply) console.log("書き戻すには: pnpm --filter worker inbound:reparse apply");
}

runCli(main);
