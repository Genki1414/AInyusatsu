// ワーカーが生きているかの判定。
//
// 【なぜ判定が要るか】
// 2026-09-03 にワーカーが落ち、6日間だれも気づかなかった。
// 異常を知らせる notify-ops はワーカーの中にあるので、ワーカーが死ぬと通知も死ぬ。
// 「何も届かない」を正常と読み違えないよう、生きているかを別の軸で出す。
//
// 【時刻の差だけで決める】
// ワーカーは10分ごとに合図を書く。書かれていない時間の長さで判断する。
// pg-boss のジョブ履歴を読む手もあるが、ジョブは1時間に1回しか動かないので
// 気づくのが遅れる。合図なら10分で分かる。

/** ワーカーが合図を書く間隔（分）。apps/worker/src/index.ts の HEARTBEAT_MINUTES と揃える。 */
export const HEARTBEAT_MINUTES = 10;

export type WorkerState = "正常" | "遅れています" | "止まっています" | "未起動";

export type WorkerHealth = {
  state: WorkerState;
  /** 画面に出す説明。何をすればよいかまで書く */
  detail: string;
  /** 最後の合図からの経過（分）。合図が無ければ null */
  minutesAgo: number | null;
};

/**
 * 最後の合図から、いまの状態を決める。
 *
 * 【なぜ2倍を正常の境にするか】
 * 10分ごとの合図なので、1回飛ぶことはある（デプロイ直後、DBの一時的な混雑）。
 * 1回飛んだだけで赤くすると、赤が当たり前になって誰も見なくなる。
 * 2回続けて飛んだら異常として扱う。
 */
export function workerHealth(beatAt: string | null | undefined, now: Date = new Date()): WorkerHealth {
  if (beatAt === null || beatAt === undefined || beatAt === "") {
    return {
      state: "未起動",
      detail: "ワーカーが一度も動いていません。Railwayでデプロイされているか確認してください。",
      minutesAgo: null,
    };
  }
  const at = Date.parse(beatAt);
  if (Number.isNaN(at)) {
    return { state: "未起動", detail: "最終稼働の時刻が読めません。", minutesAgo: null };
  }

  const minutesAgo = Math.floor((now.getTime() - at) / 60000);
  // 未来の時刻（時計のずれ）は0として扱う。マイナスを画面に出さない
  const elapsed = Math.max(0, minutesAgo);

  if (elapsed <= HEARTBEAT_MINUTES * 2) {
    return { state: "正常", detail: "ワーカーは動いています。", minutesAgo: elapsed };
  }
  if (elapsed <= 60) {
    return {
      state: "遅れています",
      detail: `${HEARTBEAT_MINUTES}分ごとの合図が届いていません。重いジョブの最中かもしれません。あと少し見て、戻らなければRailwayのログを確認してください。`,
      minutesAgo: elapsed,
    };
  }
  return {
    state: "止まっています",
    detail:
      "1時間以上、合図が届いていません。収集・催促・通知のすべてが止まっています。" +
      "Railwayでサービスの状態とログを確認し、必要なら再デプロイしてください。",
    minutesAgo: elapsed,
  };
}

/** 経過時間を日本語にする。 */
export function elapsedLabel(minutesAgo: number | null): string {
  if (minutesAgo === null) return "記録がありません";
  if (minutesAgo < 1) return "たった今";
  if (minutesAgo < 60) return `${minutesAgo}分前`;
  const hours = Math.floor(minutesAgo / 60);
  if (hours < 24) return `${hours}時間前`;
  return `${Math.floor(hours / 24)}日前`;
}
