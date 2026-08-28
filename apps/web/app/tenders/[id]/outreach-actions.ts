"use server";

// 依頼先がいない業種を、営業AI（eigyouAI）の登録企業から探す（9月分：協力会社開拓）。
//
// 【送信はしない】
// ここでやるのは「何社いるか見る」と「送信先リストを作る」まで。
// フォームへの送信は営業AI側の画面から人が実行する
// （CLAUDE.md「やらないこと：問い合わせフォームへの自動送信」）。
// このファイルに送信を呼ぶ処理は書かないこと。
//
// 【対応表に無い業種では動かさない】
// 営業AIの絞り込みは、知らない業種の値を黙って捨てる。捨てられると業種の条件が消えて
// 「その都道府県の全社」が対象になり、面識の無い会社への一斉送信になる。
// 変換できない業種は、ここで止める。

import { createTargetList, OutreachError, previewTargets } from "@ai-nyusatsu-bu/outreach";
import { prefectureFromPlace, toSalesAiTrade, type TradeMap } from "@ai-nyusatsu-bu/domain";
import { requireOrgContext } from "@/lib/auth";

export type OutreachState = {
  error: string | null;
  message: string | null;
  /** 見つかった件数。まだ探していなければ null */
  count: number | null;
  /** 確認用の数社 */
  sample: { name: string; pref: string | null }[];
  /** 作ったリストの番号。作っていなければ null */
  listId: number | null;
};

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function fail(error: string): OutreachState {
  return { error, message: null, count: null, sample: [], listId: null };
}

type Resolved = {
  connection: { baseUrl: string; apiKey: string };
  filters: { prefs: string[]; trades: string[]; contactReady: boolean };
  trade: string;
  tenderName: string;
};

/** 接続設定と業種の変換をまとめて解決する。どちらか欠けていれば理由を返す。 */
async function resolve(formData: FormData): Promise<Resolved | { error: string }> {
  const trade = text(formData, "trade").trim();
  const tenderId = text(formData, "tender_id").trim();
  if (trade === "" || tenderId === "") return { error: "業種または案件が指定されていません" };

  const { supabase, orgId } = await requireOrgContext();

  const [{ data: connection }, { data: tender }] = await Promise.all([
    supabase
      .from("sales_ai_connections")
      .select("base_url, api_key, trade_map")
      .eq("org_id", orgId)
      .maybeSingle<{ base_url: string; api_key: string; trade_map: TradeMap }>(),
    supabase.from("tenders").select("name, place").eq("id", tenderId).maybeSingle<{ name: string; place: string | null }>(),
  ]);

  if (!connection) return { error: "営業AIの接続設定がありません。「自社情報」から設定してください。" };
  if (!tender) return { error: "案件が見つかりません" };

  const code = toSalesAiTrade(connection.trade_map ?? {}, trade);
  if (code === null) {
    return {
      error: `「${trade}」に対応する営業AIの業種コードが設定されていません。「自社情報」の業種の対応表に追加してください。`,
    };
  }

  // 履行場所から都道府県が取れなければ、地域では絞らない（推測で別の県を入れない）
  const pref = prefectureFromPlace(tender.place);
  return {
    connection: { baseUrl: connection.base_url, apiKey: connection.api_key },
    // 問い合わせページが分かっている会社だけにする。送り先の無い会社をリストに入れても意味がない
    filters: { prefs: pref ? [pref] : [], trades: [code], contactReady: true },
    trade,
    tenderName: tender.name,
  };
}

function describe(err: unknown): string {
  return err instanceof OutreachError ? `${err.code}：${err.message}` : String(err);
}

/** 何社いるかを見る。リストは作らない。 */
export async function previewOutreachTargets(_prev: OutreachState, formData: FormData): Promise<OutreachState> {
  const resolved = await resolve(formData);
  if ("error" in resolved) return fail(resolved.error);

  try {
    const preview = await previewTargets(resolved.connection, resolved.filters);
    const where = resolved.filters.prefs[0] ?? "全国";
    return {
      error: null,
      message:
        preview.count === 0
          ? `${where}に、条件に合う会社は見つかりませんでした。営業AI側の登録企業を増やすか、業種の対応表を見直してください。`
          : `${where}で${preview.count}社が見つかりました。` +
            (preview.capped ? `（営業AI側の上限で${preview.countBeforeCap}社から絞られています）` : ""),
      count: preview.count,
      sample: preview.sample,
      listId: null,
    };
  } catch (err) {
    return fail(`営業AIに問い合わせできませんでした（${describe(err)}）`);
  }
}

/**
 * 送信先リストを作る。**送信はしない。**
 * 作ったあと、営業AIの画面で内容を確かめてから人が送る。
 */
export async function createOutreachList(_prev: OutreachState, formData: FormData): Promise<OutreachState> {
  const resolved = await resolve(formData);
  if ("error" in resolved) return fail(resolved.error);

  // どの案件のどの業種で作ったかが、営業AI側の一覧で分かる名前にする
  const name = `${resolved.trade}｜${resolved.tenderName}`.slice(0, 120);
  try {
    const created = await createTargetList(resolved.connection, name, resolved.filters);
    return {
      error: null,
      message:
        `営業AIに送信先リスト「${name}」を作りました（${created.count}社）。` +
        "内容を営業AIの画面で確認してから、ご自身で送信してください。この製品からは送信しません。",
      count: created.count,
      sample: [],
      listId: created.listId,
    };
  } catch (err) {
    return fail(`リストを作れませんでした（${describe(err)}）`);
  }
}
