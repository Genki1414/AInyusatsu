"use server";

// 案件ごとの「参加するかどうか」を決める（見送り / 検討 / 保留 / 参加）。
//
// 【work_status は触らない】
// work_status（募集開始 / 積算中 / 提出済）は作業がどこまで進んだかで、
// 応札価格を入れた・書類を出した、といった操作で自動的に動く。
// stance は人がどうしたいかなので、片方を変えてももう片方は動かさない。

import { revalidatePath } from "next/cache";
import { acceptsAmount, isBidResult, isRoadmapStepKey, isTenderStance, isWon } from "@ai-nyusatsu-bu/domain";
import { requireOrgContext } from "@/lib/auth";

export type StanceState = { error: string | null; message: string | null };

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

export async function setTenderStance(_prev: StanceState, formData: FormData): Promise<StanceState> {
  const { supabase, orgId } = await requireOrgContext();

  const tenderId = text(formData, "tender_id").trim();
  const stance = text(formData, "stance").trim();
  if (tenderId === "") return { error: "案件が指定されていません", message: null };
  // 画面が壊れて知らない値が入ると、一覧の絞り込みから外れて見えなくなる
  if (!isTenderStance(stance)) return { error: `「${stance}」は選べません`, message: null };

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("company_tenders")
    .upsert({ org_id: orgId, tender_id: tenderId, stance, stance_at: now }, { onConflict: "org_id,tender_id" });
  if (error) return { error: `保存できませんでした（${error.message}）`, message: null };

  revalidatePath(`/tenders/${tenderId}`);
  revalidatePath("/tenders");
  revalidatePath("/");
  return {
    error: null,
    message:
      stance === "参加"
        ? "「参加」にしました。下に、提出までの段取りが出ます。"
        : `「${stance}」にしました。`,
  };
}

export type BidResultState = { error: string | null; message: string | null };

/** 金額を円のintegerにする。カンマや全角も受ける（手で打つ欄なので）。 */
function parseYen(raw: string): { ok: true; value: number | null } | { ok: false; error: string } {
  const text = raw.trim().replace(/[，,\s]/g, "").replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  if (text === "") return { ok: true, value: null };
  if (!/^\d+$/.test(text)) return { ok: false, error: "金額は数字で入力してください（円）" };
  const value = Number(text);
  if (!Number.isSafeInteger(value)) return { ok: false, error: "金額が大きすぎます" };
  return { ok: true, value };
}

/**
 * 入札の結果を記録する。
 *
 * 【stance は変えない】
 * stance（参加するかの意思）と結果は別の軸。結果で上書きすると、
 * そもそも参加したのかが分からなくなる。「参加」のまま「落札」を持たせる。
 *
 * 【辞退・中止では金額を持たせない】
 * 決まった金額が無いのに数字が残ると、あとで相場の材料として読み違える。
 */
export async function setBidResult(_prev: BidResultState, formData: FormData): Promise<BidResultState> {
  const { supabase, orgId } = await requireOrgContext();

  const tenderId = text(formData, "tender_id").trim();
  const result = text(formData, "bid_result").trim();
  if (tenderId === "") return { error: "案件が指定されていません", message: null };
  if (!isBidResult(result) || result === "未入力") return { error: `「${result}」は選べません`, message: null };

  const amount = parseYen(text(formData, "result_amount"));
  if (!amount.ok) return { error: amount.error, message: null };
  const memo = text(formData, "result_memo").trim();

  const now = new Date().toISOString();
  const { error } = await supabase.from("company_tenders").upsert(
    {
      org_id: orgId,
      tender_id: tenderId,
      bid_result: result,
      // 辞退・中止では金額を持たせない（決まった金額が無い）
      result_amount: acceptsAmount(result) ? amount.value : null,
      result_memo: memo === "" ? null : memo,
      result_at: now,
    },
    { onConflict: "org_id,tender_id" },
  );
  if (error) return { error: `保存できませんでした（${error.message}）`, message: null };

  revalidatePath(`/tenders/${tenderId}`);
  revalidatePath("/tenders");
  return {
    error: null,
    message: isWon(result)
      ? "「落札」で記録しました。案件一覧の「結果：落札」から見られます。"
      : `「${result}」で記録しました。`,
  };
}

export type RoadmapState = { error: string | null; message: string | null };

/**
 * 段取りを1つ、やった／やっていないに切り替える。
 *
 * 【なぜ手で入れてもらうか】
 * 質問を電話でしたか、開札の結果を確認したかは、本サービスには届かない。
 * **取れないものを取れたことにしない**（CLAUDE.md 最重要の前提7）ので、ここは人が入れる。
 *
 * 【記録で分かるものは、記録が優先】
 * 見積依頼を送った等、記録で終わったと分かる段取りは buildRoadmap 側で済になる。
 * ここでチェックを外しても済のままなので、画面ではその欄を押せなくしてある。
 *
 * 【読んでから書く】
 * 配列の一部だけを更新できないため、いまの値を読んで足し引きして書き戻す。
 * 同じ案件を2つの画面で同時に触ると後勝ちになるが、段取りのチェックは
 * 本人が1人で押すものなので、ここでは競合を作り込まない。
 */
export async function toggleRoadmapStep(_prev: RoadmapState, formData: FormData): Promise<RoadmapState> {
  const { supabase, orgId } = await requireOrgContext();

  const tenderId = text(formData, "tender_id").trim();
  const step = text(formData, "step").trim();
  const checked = text(formData, "checked").trim() === "1";
  if (tenderId === "") return { error: "案件が指定されていません", message: null };
  // 知らないキーを入れると、画面に出ないゴミが残る
  if (!isRoadmapStepKey(step)) return { error: `「${step}」は段取りにありません`, message: null };

  const { data: current, error: readError } = await supabase
    .from("company_tenders")
    .select("roadmap_done")
    .eq("org_id", orgId)
    .eq("tender_id", tenderId)
    .maybeSingle<{ roadmap_done: string[] | null }>();
  if (readError) return { error: `保存できませんでした（${readError.message}）`, message: null };

  const before = current?.roadmap_done ?? [];
  const after = checked ? [...new Set([...before, step])] : before.filter((k) => k !== step);

  const { error } = await supabase
    .from("company_tenders")
    .upsert({ org_id: orgId, tender_id: tenderId, roadmap_done: after }, { onConflict: "org_id,tender_id" });
  if (error) return { error: `保存できませんでした（${error.message}）`, message: null };

  revalidatePath(`/tenders/${tenderId}`);
  return { error: null, message: null };
}
