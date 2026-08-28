"use server";

// 依頼先がいない業種を、営業AI（eigyouAI）の登録企業から探す（9月分：協力会社開拓）。
//
// 【送信は人がボタンを押したときだけ】
// CLAUDE.md「やらないこと：問い合わせフォームへの無人の自動送信」。
// このファイルの送信は、利用者が画面のボタンを押したときにだけ動く。
// 定期実行やジョブからここを呼ばないこと。
//
// 実際にフォームへ送るのは営業AI側で、送信先の除外・回数の上限・停止スイッチも
// すべて営業AIが持っている。こちらで作り直さない。
//
// 【対応表に無い業種では動かさない】
// 営業AIの絞り込みは、知らない業種の値を黙って捨てる。捨てられると業種の条件が消えて
// 「その都道府県の全社」が対象になり、面識の無い会社への一斉送信になる。
// 変換できない業種は、ここで止める。

import { createTargetList, OutreachError, previewTargets, sendTargetList } from "@ai-nyusatsu-bu/outreach";
import { buildOutreachMessage, prefectureFromPlace, toSalesAiTrade, type TradeMap } from "@ai-nyusatsu-bu/domain";
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
  tender: TenderForOutreach;
  orgName: string;
  userName: string;
  userEmail: string;
};

type TenderForOutreach = {
  name: string;
  place: string | null;
  term_from: string | null;
  term_to: string | null;
  source_url: string | null;
  agencies: { name: string } | { name: string }[] | null;
};

function one<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

/** 接続設定と業種の変換をまとめて解決する。どちらか欠けていれば理由を返す。 */
async function resolve(formData: FormData): Promise<Resolved | { error: string }> {
  const trade = text(formData, "trade").trim();
  const tenderId = text(formData, "tender_id").trim();
  if (trade === "" || tenderId === "") return { error: "業種または案件が指定されていません" };

  const { supabase, orgId, orgName, userName, userEmail } = await requireOrgContext();

  const [{ data: connection }, { data: tender }] = await Promise.all([
    supabase
      .from("sales_ai_connections")
      .select("base_url, api_key, trade_map")
      .eq("org_id", orgId)
      .maybeSingle<{ base_url: string; api_key: string; trade_map: TradeMap }>(),
    supabase
      .from("tenders")
      .select("name, place, term_from, term_to, source_url, agencies(name)")
      .eq("id", tenderId)
      .maybeSingle<TenderForOutreach>(),
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
    tender,
    orgName,
    userName,
    userEmail,
  };
}

/** 打診文を組み立てる。見積依頼の文面とは別（回答ページのURLも数量表も入れない）。 */
function outreachMessage(resolved: Resolved) {
  return buildOutreachMessage({
    senderOrgName: resolved.orgName,
    senderContactName: resolved.userName,
    senderContactEmail: resolved.userEmail,
    trade: resolved.trade,
    tenderName: resolved.tender.name,
    agencyName: one(resolved.tender.agencies)?.name ?? null,
    place: resolved.tender.place,
    termFrom: resolved.tender.term_from,
    termTo: resolved.tender.term_to,
    // 面識の無い相手に分単位の締切を押し付けない
    replyByLabel: null,
    sourceUrl: resolved.tender.source_url,
  });
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
 * 候補を選んでリストを作り、そのまま送信する。
 *
 * 【1回のボタンで最後までやる】
 * 利用者にさせるのは送信ボタンを押すことだけ（ユーザー決定 2026-08-28）。
 * リストを作ってから別の画面で送る形にすると、押し忘れて止まる。
 *
 * 【押される前に何も送らない】
 * この関数は画面のボタンからしか呼ばれない。定期実行やジョブから呼ばないこと
 * （CLAUDE.md「やらないこと：問い合わせフォームへの無人の自動送信」）。
 *
 * 【送ったあとは取り消せない】
 * 呼び出し側で件数を見せ、確認を挟むこと（ConfirmSubmitButton）。
 */
export async function sendOutreach(_prev: OutreachState, formData: FormData): Promise<OutreachState> {
  const resolved = await resolve(formData);
  if ("error" in resolved) return fail(resolved.error);

  // どの案件のどの業種で作ったかが、営業AI側の一覧で分かる名前にする
  const name = `${resolved.trade}｜${resolved.tender.name}`.slice(0, 120);

  let created;
  try {
    created = await createTargetList(resolved.connection, name, resolved.filters);
  } catch (err) {
    return fail(`送信先リストを作れませんでした（${describe(err)}）`);
  }
  if (created.count === 0) {
    return {
      ...fail(
        "条件に合う会社が0社でした。営業AI側の登録企業を増やすか、業種の対応表を見直してください。",
      ),
      listId: created.listId,
    };
  }

  const message = outreachMessage(resolved);
  try {
    const sent = await sendTargetList(resolved.connection, created.listId, message);
    const skipped = sent.requested - sent.stats.sent;
    return {
      error: null,
      message:
        `${sent.requested}社へ送信を頼みました（リスト「${name}」。成功${sent.stats.sent}社` +
        `${skipped > 0 ? `／見送り${skipped}社` : ""}）。結果は営業AIの画面で確認できます。` +
        (sent.note ? `／${sent.note}` : ""),
      count: sent.requested,
      sample: [],
      listId: created.listId,
    };
  } catch (err) {
    // リストは作れたが送れなかった。作り直させないよう、リストの番号を残す
    return {
      ...fail(
        `送信先リスト「${name}」は作れましたが、送信できませんでした（${describe(err)}）。` +
          "営業AIの画面から、このリストを確認してください。",
      ),
      listId: created.listId,
    };
  }
}
