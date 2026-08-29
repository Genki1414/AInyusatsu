// 本部への異常通知をローカルから1回だけ実行するCLI。
// 使い方: pnpm --filter worker notify:ops
//
// 【リリース前に必ず1回叩くこと】
// 宛先（ADMIN_EMAILS）と Resend の設定が正しいかは、実際に届いて初めて分かる。
// ワーカーを常駐させる前に、手元から1通送って受信を確かめる。
// 参照：docs/reference/ローカル実行手順.md

import { runNotifyOps } from "../jobs/notify_ops";
import { cliArgs, rejectExtraArgs, runCli } from "./_args";

const USAGE = "pnpm --filter worker notify:ops";

async function main() {
  rejectExtraArgs(cliArgs(), 0, USAGE);

  console.log("本部あてに、収集の失敗・欠測・ジョブの失敗をまとめて送ります");
  const result = await runNotifyOps();
  console.log(JSON.stringify(result, null, 2));
  if (result.sent === 0) {
    console.error("1通も送れていません。ADMIN_EMAILS と RESEND_API_KEY を確認してください");
  }
}

runCli(main);
