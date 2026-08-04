// AI解析結果の保存ジョブ（タスク2-4・2-5）をローカルから実行するCLI。
// 使い方: pnpm --filter worker analyze:tender -- <tenders.id>
// 事前条件：対象案件の資料でタスク2-2のテキスト抽出が完了していること
//   （pnpm --filter worker documents:extract-text）
// 参照：docs/reference/ローカル実行手順.md

import { analyzeTender } from "../jobs/analyze_tender";
import { cliArgs } from "./_args";

async function main() {
  const tenderId = cliArgs()[0];
  if (!tenderId) {
    console.error("使い方: pnpm --filter worker analyze:tender -- <tenders.id>");
    process.exitCode = 1;
    return;
  }
  console.log(`案件を解析します（tender=${tenderId}）`);
  const result = await analyzeTender(tenderId);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
