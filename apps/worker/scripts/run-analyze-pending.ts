// 解析待ちの案件をまとめてAI解析するCLI。
// 使い方: pnpm --filter worker analyze:pending            # 既定の50件
//         pnpm --filter worker analyze:pending -- 200      # 件数を指定
// 参照：docs/reference/ローカル実行手順.md
//
// 【費用がかかる唯一のジョブ】
// 実測で1案件あたり約69円（プロンプトキャッシュ実装後・平均サイズ）。
// 実行前に見込み額を出して、意図せず大きな請求にならないようにする。

import { DEFAULT_ANALYZE_LIMIT, analyzeLimitFromEnv, runAnalyzePending } from "../jobs/analyze_pending";
import { cliArgs } from "./_args";

/** 実測の1案件あたりの費用（円）。見込み額の表示にだけ使う。 */
const YEN_PER_TENDER = 69;

async function main() {
  const raw = cliArgs()[0];
  let limit: number;
  if (raw === undefined) {
    limit = analyzeLimitFromEnv();
  } else {
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < 0) {
      throw new Error(`件数は0以上の整数で指定してください（受け取った値: ${raw}）。既定は${DEFAULT_ANALYZE_LIMIT}件です`);
    }
    limit = parsed;
  }

  console.log(
    `解析待ちの案件を最大${limit}件、提出期限が近い順に解析します（見込み ${(limit * YEN_PER_TENDER).toLocaleString("ja-JP")}円まで）`,
  );
  const summary = await runAnalyzePending(limit);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
