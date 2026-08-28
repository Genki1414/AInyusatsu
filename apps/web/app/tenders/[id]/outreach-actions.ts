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

import {
  createTargetList,
  listSentCompanies,
  markReplied,
  OutreachError,
  previewTargets,
  sendTargetList,
  type OutreachCompany,
} from "@ai-nyusatsu-bu/outreach";
import {
  buildOutreachMessage,
  canRegisterAsPartner,
  findExistingPartner,
  prefectureFromPlace,
  summarizeOutreachSend,
  toPartnerDraft,
  toSalesAiTrade,
  tradesAfterAdding,
} from "@ai-nyusatsu-bu/domain";
import { revalidatePath } from "next/cache";
import { requireOrgContext } from "@/lib/auth";
import { loadSalesAiConnection } from "@/lib/sales-ai";

export type OutreachState = {
  error: string | null;
  message: string | null;
  /** 見つかった件数。まだ探していなければ null */
  count: number | null;
  /** 確認用の数社 */
  sample: { name: string; pref: string | null }[];
  /** 作ったリストの番号。作っていなければ null */
  listId: number | null;
  /** まだ送れていない会社が残っている。もう一度押せば続きから送れる */
  hasRemaining: boolean;
};

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function fail(error: string): OutreachState {
  return { error, message: null, count: null, sample: [], listId: null, hasRemaining: false };
}

type Resolved = {
  /** 呼び出し側で控えの読み書きに使う。org_id は必ずここのものを使う */
  supabase: Awaited<ReturnType<typeof requireOrgContext>>["supabase"];
  orgId: string;
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

  // 接続設定は本部が持つ。APIキーは顧客のRLSでは読めないので service_role で引く
  // （apps/web/lib/sales-ai.ts）。org_id は requireOrgContext が返したものだけを渡す
  const [connection, { data: tender }] = await Promise.all([
    loadSalesAiConnection(orgId),
    supabase
      .from("tenders")
      .select("name, place, term_from, term_to, source_url, agencies(name)")
      .eq("id", tenderId)
      .maybeSingle<TenderForOutreach>(),
  ]);

  // 設定するのは本部なので、顧客に設定画面を案内しない
  if (!connection) return { error: "営業AIをご利用いただける状態になっていません。本部までご連絡ください。" };
  if (!tender) return { error: "案件が見つかりません" };

  const code = toSalesAiTrade(connection.tradeMap, trade);
  if (code === null) {
    return {
      error: `「${trade}」は営業AIでの開拓に対応していません。この業種を追加したい場合は本部までご連絡ください。`,
    };
  }

  // 履行場所から都道府県が取れなければ、地域では絞らない（推測で別の県を入れない）
  const pref = prefectureFromPlace(tender.place);
  return {
    supabase,
    orgId,
    connection: { baseUrl: connection.baseUrl, apiKey: connection.apiKey },
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
          ? `${where}に、条件に合う会社は見つかりませんでした。この業種の候補が営業AIにまだ登録されていない可能性があります。本部までご連絡ください。`
          : `${where}で${preview.count}社が見つかりました。` +
            (preview.capped ? `（営業AI側の上限で${preview.countBeforeCap}社から絞られています）` : ""),
      count: preview.count,
      sample: preview.sample,
      listId: null,
      hasRemaining: false,
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
  const { supabase, orgId } = resolved;
  const tenderId = text(formData, "tender_id").trim();

  // どの案件のどの業種で作ったかが、営業AI側の一覧で分かる名前にする
  const name = `${resolved.trade}｜${resolved.tender.name}`.slice(0, 120);

  // 【同じリストへ送る】
  // 営業AIは1回に最大50社しか送らない。残りを送るときに新しいリストを作ると
  // 新しいキャンペーンになり、**もう送った会社にもう一度届く**
  // （送信済みの判定は touches(campaign_id, company_id) で行われるため）。
  // 一度作ったリストの番号を覚えておき、送り直しは必ずそこへ積む。
  const { data: existing, error: existingError } = await supabase
    .from("outreach_sends")
    .select("id, list_id, list_name")
    .eq("org_id", orgId)
    .eq("tender_id", tenderId)
    .eq("trade", resolved.trade)
    .maybeSingle<{ id: string; list_id: number; list_name: string }>();
  if (existingError) {
    // ここで進むと、送信済みの会社へもう一度送ってしまう。止める
    return fail(`送信先リストの控えを読めませんでした（${existingError.message}）。もう一度お試しください。`);
  }

  let listId = existing?.list_id ?? null;
  if (listId === null) {
    let created;
    try {
      created = await createTargetList(resolved.connection, name, resolved.filters);
    } catch (err) {
      return fail(`送信先リストを作れませんでした（${describe(err)}）`);
    }
    if (created.count === 0) {
      return {
        ...fail(
          "条件に合う会社が0社でした。この業種の候補が営業AIにまだ登録されていない可能性があります。本部までご連絡ください。",
        ),
        listId: created.listId,
      };
    }
    listId = created.listId;

    // 送信の前に控える。送信で落ちても番号が残るようにする
    // （残らないと、次に押したときに別のリストを作ってしまう）
    const { error: saveError } = await supabase
      .from("outreach_sends")
      .insert({ org_id: orgId, tender_id: tenderId, trade: resolved.trade, list_id: listId, list_name: name });
    if (saveError) {
      return {
        ...fail(
          `送信先リスト（番号${listId}）は作れましたが、控えを保存できませんでした（${saveError.message}）。` +
            "このまま送ると次回に二重送信のおそれがあるため、送信していません。本部までご連絡ください。",
        ),
        listId,
      };
    }
  }

  const message = outreachMessage(resolved);
  try {
    const sent = await sendTargetList(resolved.connection, listId, message);
    await supabase
      .from("outreach_sends")
      .update({ last_sent_at: new Date().toISOString() })
      .eq("org_id", orgId)
      .eq("tender_id", tenderId)
      .eq("trade", resolved.trade);
    revalidatePath(`/tenders/${tenderId}`);

    // 頼んだ数をそのまま出さない。営業AIは1回の呼び出しで全件を送るとは限らない
    // （1回50社の上限・月/日の上限・停止スイッチ・配信停止）。
    // 送信は取り消せないので、送れなかった分は必ず伝える
    const summary = summarizeOutreachSend(sent);
    if (summary.nothingSent) {
      return { ...fail(summary.message), listId, hasRemaining: summary.hasRemaining };
    }
    return {
      error: null,
      message: `${summary.message}（リスト「${existing?.list_name ?? name}」）`,
      count: sent.sent,
      sample: [],
      listId,
      hasRemaining: summary.hasRemaining,
    };
  } catch (err) {
    return {
      ...fail(
        `送信できませんでした（${describe(err)}）。送信先リスト（番号${listId}）は残っているので、` +
          "もう一度「送信する」を押すと同じリストへ送ります（送信済みの会社には届きません）。",
      ),
      listId,
      hasRemaining: true,
    };
  }
}

// ── 結果の取り込み（送った会社を協力会社として登録する） ──────────────

export type OutreachResultsState = {
  error: string | null;
  message: string | null;
  companies: OutreachCompany[];
};

/**
 * 実際に送れた会社を営業AIから引く。
 *
 * 【なぜ「返信のあった会社」ではないか】
 * 営業AIの replied は人が手で立てるフラグで、営業AIはメールボックスを
 * 見ていない。返信は打診文に書いた連絡先＝利用者自身のメールに届く。
 * だから「送った会社」を出して、返信をもらった会社を利用者に選んでもらう。
 */
export async function loadOutreachResults(
  _prev: OutreachResultsState,
  formData: FormData,
): Promise<OutreachResultsState> {
  const resolved = await resolve(formData);
  if ("error" in resolved) return { error: resolved.error, message: null, companies: [] };
  const listId = await storedListId(resolved, text(formData, "tender_id").trim());
  if (listId === null) {
    return { error: "この業種ではまだ営業AIへ送っていません。", message: null, companies: [] };
  }

  try {
    const companies = await listSentCompanies(resolved.connection, listId);
    return {
      error: null,
      message:
        companies.length === 0
          ? "まだ1社にも送れていません。送信の直後は、営業AI側の処理が終わるまで出ないことがあります。"
          : `${companies.length}社に送っています。返信をもらった会社を協力会社として登録してください。`,
      companies,
    };
  } catch (err) {
    return { error: `営業AIに問い合わせできませんでした（${describe(err)}）`, message: null, companies: [] };
  }
}

async function storedListId(resolved: Resolved, tenderId: string): Promise<number | null> {
  const { data } = await resolved.supabase
    .from("outreach_sends")
    .select("list_id")
    .eq("org_id", resolved.orgId)
    .eq("tender_id", tenderId)
    .eq("trade", resolved.trade)
    .maybeSingle<{ list_id: number }>();
  return data?.list_id ?? null;
}

export type RegisterPartnerState = { error: string | null; message: string | null };

/**
 * 打診に返信をくれた会社を、協力会社として登録する。
 *
 * 【営業AI側にも記録する】
 * 営業AIのダッシュボードは target_list_members.replied を数えている。
 * こちらだけで登録すると、営業AI側は「1件も返信が無い」ままになる。
 * ただし営業AIへの記録に失敗しても登録自体は成立させる
 * （こちらの協力会社が増えることのほうが大事）。理由はメッセージに出す。
 */
export async function registerPartnerFromOutreach(
  _prev: RegisterPartnerState,
  formData: FormData,
): Promise<RegisterPartnerState> {
  const resolved = await resolve(formData);
  if ("error" in resolved) return { error: resolved.error, message: null };
  const { supabase, orgId } = resolved;
  const tenderId = text(formData, "tender_id").trim();

  const companyId = Number(text(formData, "company_id"));
  const company = {
    companyId: Number.isFinite(companyId) ? companyId : 0,
    name: text(formData, "name"),
    pref: text(formData, "pref") || null,
    tel: text(formData, "tel") || null,
    email: text(formData, "email") || null,
    contactUrl: text(formData, "contact_url") || null,
    websiteUrl: text(formData, "website_url") || null,
  };
  if (!canRegisterAsPartner(company)) {
    return { error: "社名が分からない会社は登録できません。", message: null };
  }

  const { data: partners, error: partnersError } = await supabase
    .from("partners")
    .select("id, name, trades")
    .eq("org_id", orgId)
    .returns<{ id: string; name: string; trades: string[] }[]>();
  if (partnersError) {
    return { error: `協力会社を読めませんでした（${partnersError.message}）`, message: null };
  }

  // 二重登録すると、同じ会社へ見積依頼が2通行く。社名で照合してから入れる
  const existing = findExistingPartner<{ id: string; name: string; trades: string[] }>(
    partners ?? [],
    company.name,
  );
  let note: string;
  if (existing) {
    const trades = tradesAfterAdding(existing.trades ?? [], resolved.trade);
    const { error } = await supabase.from("partners").update({ trades }).eq("id", existing.id);
    if (error) return { error: `協力会社を更新できませんでした（${error.message}）`, message: null };
    note =
      trades.length === (existing.trades ?? []).length
        ? `${existing.name} はすでに協力会社として登録されています。`
        : `${existing.name} はすでに登録されていたので、「${resolved.trade}」を足しました。`;
  } else {
    const draft = toPartnerDraft(company, {
      trade: resolved.trade,
      tenderName: resolved.tender.name,
      sentOnLabel: text(formData, "sent_on") || null,
    });
    const { error } = await supabase.from("partners").insert({ org_id: orgId, ...draft });
    if (error) return { error: `協力会社を登録できませんでした（${error.message}）`, message: null };
    note = draft.email
      ? `${draft.name} を協力会社として登録しました。次の案件から見積依頼を出せます。`
      : `${draft.name} を協力会社として登録しました。` +
        "メールアドレスが分からないため、このままでは見積依頼を送れません。" +
        "「協力会社」からメールアドレスを追加してください。";
  }

  // 営業AI側にも返信を記録して、両方の数を揃える。失敗しても登録は取り消さない
  let syncNote = "";
  const listId = await storedListId(resolved, tenderId);
  if (listId !== null && company.companyId > 0) {
    try {
      await markReplied(resolved.connection, listId, company.companyId, `協力会社として登録（${resolved.trade}）`);
    } catch (err) {
      syncNote = `／営業AI側の返信記録は残せませんでした（${describe(err)}）`;
    }
  }

  revalidatePath(`/tenders/${tenderId}`);
  revalidatePath("/partners");
  return { error: null, message: `${note}${syncNote}` };
}
