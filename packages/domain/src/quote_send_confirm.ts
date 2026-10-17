// 見積依頼を送る前の確認。**何社か** ではなく **どこへ** を見せる。
//
// 【なぜ会社名を出すか】
// これまでの確認は「3社へ本当にメールを送信します。よろしいですか？」だった。
// 社数しか出ないので、どこへ飛ぶのかを確かめずに押すことになる。
// 外部へ出てしまったメールは取り消せない。
//
// 【見えていない選択がありうる】
// 依頼先の一覧は絞り込み（対応業種のみ・エリア・会社名）で表示を減らすが、
// 隠れた行のチェックは外れない。CSSで display:none にしているだけなので、
// **チェックしたまま絞り込みを変えると、画面に出ていない会社にも送られる。**
// 選択を勝手に消すと利用者の操作を取り消してしまうので、消すのではなく
// 「送る先を全部並べる」ことで見えるようにする。

export type QuoteSendTarget = {
  trade: string;
  /** その業種で選んだ協力会社の名前。空なら送らない */
  partnerNames: readonly string[];
};

/** 送る通数。同じ会社を2業種で選べば2通になる（業種ごとに1通ずつ送るため）。 */
export function quoteSendCount(targets: readonly QuoteSendTarget[]): number {
  return targets.reduce((sum, t) => sum + t.partnerNames.length, 0);
}

/**
 * 送信前の確認文。1社も選んでいなければ null（確認するものが無い）。
 *
 * 業種ごとに宛先を並べる。**省略しない。** 「ほかN社」で畳むと、
 * 畳んだ中に意図しない会社が入っていても気づけない。
 */
export function quoteSendConfirmMessage(targets: readonly QuoteSendTarget[]): string | null {
  const sending = targets.filter((t) => t.partnerNames.length > 0);
  const count = quoteSendCount(sending);
  if (count === 0) return null;

  const lines: string[] = [`次の${count}通のメールを送信します。`, ""];
  for (const target of sending) {
    lines.push(`【${target.trade}】`);
    for (const name of target.partnerNames) lines.push(`・${name}`);
  }
  lines.push("", "送信したメールは取り消せません。よろしいですか？");
  return lines.join("\n");
}
