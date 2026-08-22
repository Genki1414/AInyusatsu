// 案件の状態を「公開中」「終了」へ進める純ロジック（実装仕様書_v1.md §5 close ジョブ）。
//
// 【なぜ必要か】
// 案件の状態は 未取得→取得中→取得済→AI解析中→解析完了→公開中→終了 と進む。
// このうち 解析完了→公開中 と →終了 の2つは、これまでどこにも実装が無かった。
// プロトタイプでは本部が「公開」ボタンを押す形だが、その操作にあたる処理が無いまま
// 提案ジョブ（match）だけが「公開中」を対象にしていたため、提案は永久に0件だった。
//
// 【終了にする理由（公開の裏返しではない）】
// 1. 提出期限を過ぎた案件を提案し続けない
// 2. AI解析の対象から外す。解析は提出期限の近い順に並べるので、終了に落ちていない
//    期限切れの案件が真っ先に解析されてしまう（1件あたり約69円）
//
// 【推測しない】
// 提出期限が取れていない（null）案件は終了にしない。期限の誤りは失格に直結するため、
// 「たぶん終わっているだろう」で状態を進めてはいけない（CLAUDE.md 最重要の前提5）。
// ただし黙って放置もしない。件数を返して呼び出し側でログに出す。

/** tenders.collect_status の取りうる値（実装仕様書_v1.md §4）。 */
export const COLLECT_STATUSES = [
  "未取得",
  "取得中",
  "取得済",
  "AI解析中",
  "解析完了",
  "公開中",
  "終了",
] as const;

export type CollectStatus = (typeof COLLECT_STATUSES)[number];

export type LifecycleTender = {
  id: string;
  collectStatus: string;
  /** 提出期限（ISO 8601）。取れていなければ null */
  submitDeadline: string | null;
};

export type LifecycleTransition = {
  id: string;
  from: string;
  to: CollectStatus;
  reason: string;
};

export type LifecyclePlan = {
  /** 解析完了 → 公開中 */
  publish: LifecycleTransition[];
  /** 提出期限を過ぎた案件 → 終了 */
  close: LifecycleTransition[];
  /** 提出期限が取れていないため判断できなかった案件のID（終了にはしない） */
  unknownDeadline: string[];
};

/**
 * 提出期限を過ぎているか。
 * 期限が無い・日付として読めない場合は false（＝過ぎたとは判断しない）を返す。
 */
export function isDeadlinePassed(submitDeadline: string | null, now: Date): boolean {
  if (submitDeadline === null || submitDeadline.trim() === "") return false;
  const deadline = new Date(submitDeadline);
  if (Number.isNaN(deadline.getTime())) return false;
  return deadline.getTime() < now.getTime();
}

/**
 * 案件の一覧から、状態を進めるべきものを選ぶ。
 *
 * 終了の判定を先に行う。解析が終わった直後でも、提出期限を過ぎていれば公開せず
 * そのまま終了にする（公開してから終了にすると、その間に提案が作られてしまう）。
 */
export function planTenderLifecycle(tenders: LifecycleTender[], now: Date): LifecyclePlan {
  const publish: LifecycleTransition[] = [];
  const close: LifecycleTransition[] = [];
  const unknownDeadline: string[] = [];

  for (const tender of tenders) {
    if (tender.collectStatus === "終了") continue;

    if (isDeadlinePassed(tender.submitDeadline, now)) {
      close.push({
        id: tender.id,
        from: tender.collectStatus,
        to: "終了",
        reason: `提出期限（${tender.submitDeadline}）を過ぎています`,
      });
      continue;
    }

    if (tender.submitDeadline === null) {
      // 期限が取れていない案件は終了にできない。件数を数えて見えるようにする。
      unknownDeadline.push(tender.id);
    }

    if (tender.collectStatus === "解析完了") {
      publish.push({
        id: tender.id,
        from: tender.collectStatus,
        to: "公開中",
        reason: "AI解析が完了しています",
      });
    }
  }

  return { publish, close, unknownDeadline };
}
