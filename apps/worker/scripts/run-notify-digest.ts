// 毎朝1通のダイジェスト（タスク3-2 notify）をローカルから実行するCLI。
//
// 使い方:
//   pnpm --filter worker notify:digest          下見だけ（送らずに文面を出す）
//   pnpm --filter worker notify:digest send     実際に送る
//
// 参照：docs/reference/ローカル実行手順.md

import { runNotifyDigest } from "../jobs/notify_digest";
import { cliArgs, CliUsageError, rejectExtraArgs, runCli } from "./_args";

const USAGE = "pnpm --filter worker notify:digest [send]";

async function main() {
  const args = cliArgs();
  rejectExtraArgs(args, 1, USAGE);

  const mode = args[0] ?? "dry-run";
  if (mode !== "dry-run" && mode !== "send") {
    throw new CliUsageError(`指定できるのは "send" だけです（受け取った値: ${JSON.stringify(mode)}）\n使い方: ${USAGE}`);
  }
  const dryRun = mode !== "send";

  if (!dryRun && !process.env.RESEND_API_KEY) {
    throw new CliUsageError(
      "RESEND_API_KEY が設定されていません。\napps/worker/.env.local に設定してから実行してください。",
    );
  }

  console.log(
    dryRun
      ? "組織ごとに、送る予定の文面を表示します（下見のみ。送るには最後に send を付けてください）"
      : "組織ごとにダイジェストを送ります（1日1通。同じ日に2回目は送りません）",
  );

  const result = await runNotifyDigest({ dryRun });
  console.log("");
  console.log(JSON.stringify(result, null, 2));
  if (dryRun) console.log("送るには: pnpm --filter worker notify:digest send");
}

runCli(main);
