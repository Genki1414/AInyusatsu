// 見積依頼を送ったあとの、画面に出す文言。
//
// 【なぜ「すでに依頼済み」を分けるか】
// 送信後もチェックが残っていて、もう一度押すと同じ協力会社へ2通目が飛んでいた
// （2026-08-31 実機で確認）。協力会社から見ると、同じ案件の同じ業種で
// 依頼が2通届くことになり、どちらに答えればよいか分からない。
//
// 送らなかったことを黙っていると「押したのに送られていない」と見えるので、
// **失敗とは別の枠で、送らなかった理由を出す**。
//
// 【失敗を隠さない】
// 一部が失敗しても、送れた分は送れたと伝える。全部まとめて失敗にすると、
// もう一度押されて二重送信になる。

export type QuoteSendOutcome = {
  /** 実際にメールを送れた通数 */
  sentCount: number;
  /** すでに依頼済みで送らなかったもの（会社名を含む説明） */
  skipped: string[];
  /** 送ろうとして失敗したもの（会社名を含む説明） */
  failed: string[];
};

export type QuoteSendMessage = {
  /** 赤で出す。1件も送れていないときだけ入る */
  error: string | null;
  /** 送れたときの説明 */
  summary: string | null;
};

export function quoteSendMessage(outcome: QuoteSendOutcome): QuoteSendMessage {
  const { sentCount, skipped, failed } = outcome;

  if (sentCount === 0) {
    // 何も選ばれていない
    if (skipped.length === 0 && failed.length === 0) {
      return { error: "送信先の協力会社を1社以上選択してください", summary: null };
    }
    // 選んだ会社が全部「依頼済み」だった
    if (failed.length === 0) {
      return {
        error: `送信していません。選んだ会社はこの案件・業種ですでに依頼済みです：${skipped.join("／")}`,
        summary: null,
      };
    }
    return { error: `送信できませんでした：${[...failed, ...skipped].join("／")}`, summary: null };
  }

  const notes = [
    failed.length > 0 ? `送れなかったもの：${failed.join("／")}` : "",
    skipped.length > 0 ? `すでに依頼済みのため送っていません：${skipped.join("／")}` : "",
  ].filter((n) => n !== "");

  const head = `${sentCount}社へ送信しました。返信は自動で取り込みます。`;
  return { error: null, summary: notes.length === 0 ? head : `${head} ${notes.join(" ")}` };
}
