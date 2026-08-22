// 案件の公開・終了（実装仕様書_v1.md §5 close）をローカルから実行するCLI。
// 使い方: pnpm --filter worker tenders:lifecycle
// 参照：docs/reference/ローカル実行手順.md

import { runTenderLifecycle } from "../jobs/tender_lifecycle";

async function main() {
  console.log("解析完了の案件を公開中にし、提出期限を過ぎた案件を終了にします");
  const result = await runTenderLifecycle();
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
