// Batch API での案件解析（コスト対策③）をローカルから実行するCLI。
//
// 使い方:
//   pnpm --filter worker analyze:batch -- submit 1 <tenderId> [<tenderId>...]
//   pnpm --filter worker analyze:batch -- check  <batchId>
//   pnpm --filter worker analyze:batch -- apply  <batchId>
//   pnpm --filter worker analyze:batch -- submit 2 <tenderId> [<tenderId>...]
//   pnpm --filter worker analyze:batch -- cancel <batchId>
//
// 第1段（基本情報だけ）を投入 → 終了を確認 → 反映 → 第2段（残り4本）を投入、の順で回す。
// 第1段が資料をプロンプトキャッシュへ書き込み、第2段がそれを読む前提のため、この順序を守る。

import {
  applyAnalysisBatch,
  cancelAnalysisBatch,
  checkAnalysisBatch,
  stagePrompts,
  submitAnalysisBatch,
} from "../jobs/analyze_tenders_batch";
import { cliArgs } from "./_args";

const USAGE = `使い方:
  analyze:batch -- submit <1|2> <tenderId>...
  analyze:batch -- check  <batchId>
  analyze:batch -- apply  <batchId>
  analyze:batch -- cancel <batchId>`;

async function main() {
  const [command, ...rest] = cliArgs();

  if (command === "submit") {
    const stage = Number(rest[0]);
    const tenderIds = rest.slice(1);
    if (stage !== 1 && stage !== 2) throw new Error(`段は1か2を指定してください\n${USAGE}`);
    if (tenderIds.length === 0) throw new Error(`案件IDを1件以上指定してください\n${USAGE}`);

    console.log(`第${stage}段（${stagePrompts(stage).join("・")}）を${tenderIds.length}件ぶん投入します`);
    console.log(JSON.stringify(await submitAnalysisBatch(tenderIds, stage), null, 2));
    return;
  }

  if (command === "check") {
    if (!rest[0]) throw new Error(`バッチIDを指定してください\n${USAGE}`);
    console.log(JSON.stringify(await checkAnalysisBatch(rest[0]), null, 2));
    return;
  }

  if (command === "apply") {
    if (!rest[0]) throw new Error(`バッチIDを指定してください\n${USAGE}`);
    console.log("結果を回収してDBへ反映します");
    console.log(JSON.stringify(await applyAnalysisBatch(rest[0]), null, 2));
    return;
  }

  if (command === "cancel") {
    if (!rest[0]) throw new Error(`バッチIDを指定してください\n${USAGE}`);
    console.log(`取り消しました: ${await cancelAnalysisBatch(rest[0])}`);
    return;
  }

  throw new Error(USAGE);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
