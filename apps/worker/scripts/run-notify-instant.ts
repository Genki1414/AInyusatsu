// 即時通知（タスク3-2 notify）をローカルから実行するCLI。
//
// 使い方:
//   pnpm --filter worker notify:instant          下見だけ（送らずに文面を出す）
//   pnpm --filter worker notify:instant send     実際に送る
//
// 参照：docs/reference/ローカル実行手順.md

import { runNotifyInstant } from "../jobs/notify_instant";
import { cliArgs, CliUsageError, rejectExtraArgs, runCli } from "./_args";

const USAGE = "pnpm --filter worker notify:instant [send]";

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
      ? "いま送る対象の文面を表示します（下見のみ。送るには最後に send を付けてください）"
      : "質問期限・提出期限が48時間を切った案件と、届いた見積の返信を知らせます（1件につき1回だけ）",
  );

  const result = await runNotifyInstant({ dryRun });
  console.log("");
  console.log(JSON.stringify(result, null, 2));
  if (dryRun) console.log("送るには: pnpm --filter worker notify:instant send");
}

runCli(main);
