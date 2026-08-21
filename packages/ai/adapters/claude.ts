// Claude APIの唯一の呼び出し口（CLAUDE.md「外部サービスはpackages/*/adaptersのみで呼ぶ」）。
// 参照：docs/AI解析プロンプト集.md 冒頭「モデル：Claude（claude-sonnet-4-6 相当）／temperature: 0」
//
// 【判断メモ】ドキュメント記載の "claude-sonnet-4-6" は実在するモデルIDではない
// （執筆時点の見込み表記と思われる）。ドキュメントの意図（Sonnet系・temperature 0固定）に
// 沿い、実在する現行のSonnet系モデルIDを使う。モデルを変更する場合は
// docs/AI解析プロンプト集.md §8「変更したときは必ず測る」のとおりゴールドセットで再測定すること。
//
// 【実機確認済み・2026-08-04】claude-sonnet-5に対しては、`temperature`パラメータ自体が
// 廃止されており、指定するとAPIが400（invalid_request_error）を返す
// （"`temperature` is deprecated for this model."）。そのためこのモデルへは送らない。
// extract()側のインターフェース（temperature: 0固定）はドキュメントの意図を残すため
// そのままにしているが、実際にAPIへ渡すのはこのアダプタの責務なので、ここで無視する。

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
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const callClaude: CallModel = async ({ system, user, temperature: _temperature }) => {
  const res = await getClient().messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system,
    messages: [{ role: "user", content: user }],
  });

  // 応答が複数のテキストブロックに分かれることがあるため、先頭だけでなく全て連結する
  // （先頭だけを見ると、JSONが途中で切れた文字列を受け取ってparseに失敗する）。
  const text = res.content
    .filter((block): block is Extract<typeof block, { type: "text" }> => block.type === "text")
    .map((block) => block.text)
    .join("");
  if (text === "") {
    throw new Error("Claude APIの応答にテキストが含まれていません");
  }

  // 出力上限で切れた場合、そのまま返すと「壊れたJSON」として扱われ原因が分からなくなるため、
  // 理由を明示して失敗させる（CLAUDE.md「エラーは握りつぶさない」）。
  if (res.stop_reason === "max_tokens") {
    throw new Error(
      `Claude APIの出力が上限（max_tokens=${MAX_TOKENS}）に達して途中で切れました。資料が大きい可能性があります。`,
    );
  }

  return text;
};
