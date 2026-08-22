// 案件の状態を進める（実装仕様書_v1.md §5 close ジョブ）。
//
//   解析完了 → 公開中   AI解析が終わった案件を提案の対象にする
//   （どの状態でも）→ 終了   提出期限を過ぎた案件を落とす
//
// 【なぜこのジョブが要るのか】
// これまで collect_status に「公開中」を書く場所がひとつも無かった。提案ジョブ
// （match_tenders）は「公開中」だけを対象にしているため、提案は永久に0件だった。
// 手で1件ずつ流していた頃はここまで到達していなかったので気づけなかった。
//
// 判定そのものは packages/domain/src/tender_lifecycle.ts の純ロジック。
// ここはDBから読んで、決まったとおりに書き戻すだけ。

import { createServiceClient } from "@ai-nyusatsu-bu/db";
import { planTenderLifecycle, type LifecycleTender } from "@ai-nyusatsu-bu/domain";

export type TenderLifecycleResult = {
  /** 解析完了 → 公開中 にした件数 */
  published: number;
  /** 提出期限を過ぎて 終了 にした件数 */
  closed: number;
  /** 提出期限が取れていないため終了の判断ができなかった件数 */
  unknownDeadline: number;
};

type TenderRow = { id: string; collect_status: string; submit_deadline: string | null };

/** 一度のupdateで送るIDの上限。URLの長さ制限に引っかからないように分割する。 */
const CHUNK_SIZE = 200;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * 案件の状態を「公開中」「終了」へ進める。
 *
 * 終了の判定を先に行うため、期限切れの案件が一度公開されて提案が作られることはない
 * （判定の順序は planTenderLifecycle 側で保証している）。
 */
export async function runTenderLifecycle(now: Date = new Date()): Promise<TenderLifecycleResult> {
  const client = createServiceClient();

  // 終了済みは対象外。それ以外はすべて見る（期限切れは状態を問わず落とすため）。
  const { data, error } = await client
    .from("tenders")
    .select("id, collect_status, submit_deadline")
    .neq("collect_status", "終了")
    .returns<TenderRow[]>();
  if (error) throw new Error(`案件の取得に失敗しました: ${error.message}`);

  const tenders: LifecycleTender[] = (data ?? []).map((row) => ({
    id: row.id,
    collectStatus: row.collect_status,
    submitDeadline: row.submit_deadline,
  }));

  const plan = planTenderLifecycle(tenders, now);

  // 終了を先に書く。公開より先に落としておけば、間に提案ジョブが挟まっても拾われない。
  await applyStatus(client, plan.close.map((t) => t.id), "終了");
  await applyStatus(client, plan.publish.map((t) => t.id), "公開中");

  console.log(
    `[tender_lifecycle] 完了：公開${plan.publish.length}件 / 終了${plan.close.length}件（対象${tenders.length}件）`,
  );
  if (plan.unknownDeadline.length > 0) {
    // 期限が取れていない案件は終了にできない。黙って溜めずに件数を出す。
    console.warn(
      `[tender_lifecycle] 提出期限が取れていない案件が${plan.unknownDeadline.length}件あります。終了の判断ができないため公開中のまま残ります`,
    );
  }

  return { published: plan.publish.length, closed: plan.close.length, unknownDeadline: plan.unknownDeadline.length };
}

async function applyStatus(
  client: ReturnType<typeof createServiceClient>,
  ids: string[],
  status: "公開中" | "終了",
): Promise<void> {
  for (const part of chunk(ids, CHUNK_SIZE)) {
    const { error } = await client.from("tenders").update({ collect_status: status }).in("id", part);
    if (error) throw new Error(`案件を「${status}」にできませんでした: ${error.message}`);
  }
}
