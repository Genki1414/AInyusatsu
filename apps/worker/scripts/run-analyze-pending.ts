// 解析待ちの案件をまとめてAI解析するCLI。
// 使い方: pnpm --filter worker analyze:pending               # 既定の50件
//         pnpm --filter worker analyze:pending -- 200         # 件数を指定
//         pnpm --filter worker analyze:pending -- 200 90      # 公告日が90日以内の案件だけ
// 参照：docs/reference/ローカル実行手順.md
//
// 【費用がかかる唯一のジョブ】
// 実測で1案件あたり約69円（プロンプトキャッシュ実装後・平均サイズ）。
// 実行前に見込み額を出して、意図せず大きな請求にならないようにする。

import { parseMaxNoticeAgeDays } from "@ai-nyusatsu-bu/domain";
import {
  DEFAULT_ANALYZE_LIMIT,
  analyzeLimitFromEnv,
  maxNoticeAgeFromEnv,
  runAnalyzePending,
} from "../jobs/analyze_pending";
import { CliUsageError, cliArgs, rejectExtraArgs, runCli } from "./_args";

const USAGE = "pnpm --filter worker analyze:pending [-- 件数 [公告日の日数]]";

/** 実測の1案件あたりの費用（円）。見込み額の表示にだけ使う。 */
const YEN_PER_TENDER = 69;

async function main() {
  const args = cliArgs();
  rejectExtraArgs(args, 2, USAGE);
  const [raw, ageRaw] = args;
  let limit: number;
  if (raw === undefined) {
    limit = analyzeLimitFromEnv();
  } else {
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < 0) {
      throw new CliUsageError(
        `件数は0以上の整数で指定してください（受け取った値: ${JSON.stringify(raw)}）。既定は${DEFAULT_ANALYZE_LIMIT}件です`,
      );
    }
    limit = parsed;
  }

  // 公告日で絞ると、すでに締め切られている見込みの案件に費用をかけずに済む。
  // 指定が読めなければ「絞らない」に落とすが、黙って無視せず断る。
  let maxAge = maxNoticeAgeFromEnv();
  if (ageRaw !== undefined) {
    maxAge = parseMaxNoticeAgeDays(ageRaw);
    if (maxAge === null) {
      throw new CliUsageError(`公告日の日数は1以上の整数で指定してください（受け取った値: ${JSON.stringify(ageRaw)}）`);
    }
  }

  const scope = maxAge === null ? "" : `／公告日が${maxAge}日以内のものだけ`;
  console.log(
    `解析待ちの案件を最大${limit}件、提出期限が近い順に解析します（見込み ${(limit * YEN_PER_TENDER).toLocaleString("ja-JP")}円まで${scope}）`,
  );
  if (maxAge === null) {
    console.log(
      "公告日で絞っていません。解析前の案件は提出期限が未取得のため、すでに締め切られた案件も対象に含まれます。第2引数（例: 90）で公告日を絞れます",
    );
  }
  const summary = await runAnalyzePending(limit, new Date(), maxAge);
  console.log(JSON.stringify(summary, null, 2));
}

runCli(main);
