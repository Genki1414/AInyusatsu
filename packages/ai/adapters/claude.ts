// Claude APIの唯一の呼び出し口（CLAUDE.md「外部サービスはpackages/*/adaptersのみで呼ぶ」）。
// 参照：docs/AI解析プロンプト集.md 冒頭「モデル：Claude（claude-sonnet-4-6 相当）／temperature: 0」
//
// 【判断メモ】ドキュメント記載の "claude-sonnet-4-6" は実在するモデルIDではない
// （執筆時点の見込み表記と思われる）。ドキュメントの意図（Sonnet系・temperature 0固定）に
// 沿い、実在する現行のSonnet系モデルIDを使う。モデルを変更する場合は
// docs/AI解析プロンプト集.md §8「変更したときは必ず測る」のとおりゴールドセットで再測定すること。
//
// 【重要・未検証】本セッションのネットワークポリシーでANTHROPIC_API_KEYを使った実呼び出しを
// 確認できていない。実際に呼び出して確認してから使うこと。

import Anthropic from "@anthropic-ai/sdk";
import type { CallModel } from "../src/extract";

const MODEL = "claude-sonnet-5";
const MAX_TOKENS = 8192;

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (client) return client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY が設定されていません（.envを確認してください）");
  }
  client = new Anthropic({ apiKey });
  return client;
}

/** Claude APIを呼び出し、応答のテキスト部分を返す。extract()のcallModelとして渡す。 */
export const callClaude: CallModel = async ({ system, user, temperature }) => {
  const res = await getClient().messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    temperature,
    system,
    messages: [{ role: "user", content: user }],
  });

  const textBlock = res.content.find((block) => block.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Claude APIの応答にテキストが含まれていません");
  }
  return textBlock.text;
};
