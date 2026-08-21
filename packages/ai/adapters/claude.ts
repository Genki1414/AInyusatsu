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
// 数量表（プロンプト3）は行ごとに item / spec / qty / unit / trade に加えて
// evidence（原文の引用）と source を返すため、行数が多い案件では出力が長くなる。
// 8192では実データで上限に達して途中で切れることを確認したため引き上げた
// （実機で確認：大阪空港事務所庁舎等消防用設備点検業務。stop_reason=max_tokens）。
// max_tokensは上限であって使い切るわけではないので、引き上げても通常時のコストは変わらない。
const MAX_TOKENS = 32768;

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
  // ストリーミングで受け取る。max_tokensが大きいと1回の応答が10分を超えうるため、
  // SDKが非ストリーミングの呼び出しを拒否する（実機で確認：
  // "Streaming is required for operations that may take longer than 10 minutes"）。
  // finalMessage()で最後まで受け取れば、扱う形は非ストリーミングと同じMessageになる。
  const res = await getClient()
    .messages.stream({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system,
      messages: [{ role: "user", content: user }],
    })
    .finalMessage();

  // 出力上限で切れた場合、そのまま返すと「壊れたJSON」として扱われ原因が分からなくなるため、
  // 理由を明示して失敗させる（CLAUDE.md「エラーは握りつぶさない」）。
  // テキストの有無より先に判定する。上限に達すると本文が空のまま返ることがあり、
  // 順序を逆にすると「テキストが含まれていません」という的外れな理由になる（実機で発生）。
  if (res.stop_reason === "max_tokens") {
    throw new Error(
      `Claude APIの出力が上限（max_tokens=${MAX_TOKENS}）に達して途中で切れました。資料が大きい可能性があります。`,
    );
  }

  // 応答が複数のテキストブロックに分かれることがあるため、先頭だけでなく全て連結する
  // （先頭だけを見ると、JSONが途中で切れた文字列を受け取ってparseに失敗する）。
  const text = res.content
    .filter((block): block is Extract<typeof block, { type: "text" }> => block.type === "text")
    .map((block) => block.text)
    .join("");
  if (text === "") {
    // 何が返ってきたのかが分からないと調査できないため、停止理由とブロック種別を添える。
    const kinds = res.content.map((block) => block.type).join(", ") || "なし";
    throw new Error(
      `Claude APIの応答にテキストが含まれていません（stop_reason=${res.stop_reason}, ブロック種別=${kinds}）`,
    );
  }

  return text;
};
