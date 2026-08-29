"use client";

// 見積依頼。docs/ai-nyusatsu-bu-prototype-v7.jsx の RequestTab 相当。
//
// 業種ごとに数量表の該当行だけを切り出し、対象業種の協力会社（メール登録済みのみ）に
// チェックを入れて送信する。実際にメールが送信されるため、送信ボタンには確認ダイアログを
// 挟んでいる（components/ConfirmSubmitButton）。
//
// 【数量表が無い案件でも依頼できる】
// 以前は数量表から業種を切り出せない案件では見積依頼を作れなかった。実際には数量表が
// 公開されない案件も、こちらで取得できていない案件も多く、そのたびに依頼が止まっていた。
// 「資料は揃わなくても、提案できる内容があれば提案する」（CLAUDE.md 最重要の前提7）を
// 見積依頼にも適用し、業種を自分で選んで依頼できるようにしている。
// 数量表がある業種でも、それ以外の業種を足して依頼できる。
//
// 御社による正式取得（company_tenders.official_status）が「取得済」になるまでは送信できない
// （docs/資料取得方針_v3.md §5「取得済みになるまで…作業を促さない」を見積依頼にも適用する。
// ユーザーからの明示的な要望による）。サーバー側（actions.ts）でも同じ判定をしている。
import { useActionState, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ConfirmSubmitButton } from "@/components/ConfirmSubmitButton";
import { CopyButton } from "@/components/CopyButton";
import {
  loadOutreachResults,
  previewOutreachTargets,
  registerPartnerFromOutreach,
  sendOutreach,
  type OutreachResultsState,
  type OutreachState,
  type RegisterPartnerState,
} from "./outreach-actions";
import { btnClass, Panel, Pill } from "@/components/ui";
import { buildOutreachMessage, buildQuoteRequestEmail, groupLotsByTrade, type QuoteRequestLot } from "@ai-nyusatsu-bu/domain";
import { AREA_OPTIONS, PREFECTURE_OPTIONS, TRADE_OPTIONS } from "@/lib/catalog";
import { sendQuoteRequests, type SendQuoteRequestsState } from "./actions";
import { DUE_AT_PLACEHOLDER, RESPONSE_URL_PLACEHOLDER } from "./quote-request-shared";
// 型のみのimport（@ai-nyusatsu-bu/ai に依存する実装は絶対にこのファイルへ持ち込まない。
// Client Componentなのでバンドルに @anthropic-ai/sdk が混ざってしまう）。
import type { PartnerRecommendationResult } from "./recommend";

export type RequestTabPartner = {
  id: string;
  name: string;
  base: string | null;
  email: string | null;
  trades: string[];
  areas: string[];
  rating: number | null;
  memo: string | null;
};

// AIのおすすめ理由は1社ずつ丁寧に書かれる分、長くなりやすいので、既定では短く表示し、
// 必要なときだけ展開できるようにする（文章自体は変えない）。
function TruncatedText({ text, limit = 40 }: { text: string; limit?: number }) {
  const [expanded, setExpanded] = useState(false);
  if (text.length <= limit) return <>{text}</>;
  return (
    <>
      {expanded ? text : `${text.slice(0, limit)}…`}
      <button type="button" onClick={() => setExpanded((v) => !v)} className="ml-1 text-blue-800 underline">
        {expanded ? "閉じる" : "詳しく見る"}
      </button>
    </>
  );
}

/**
 * 依頼先が1社もいない業種で出す、開拓の打診文。
 *
 * ここで止まると案件そのものを諦めることになる。「協力会社を登録してください」だけでは
 * 何をすればよいか分からないので、そのまま送れる文面まで作って渡す。
 *
 * 送信はしない（CLAUDE.md「やらないこと：問い合わせフォームへの自動送信」）。
 * 文面をコピーして、営業ツールなり自分のメールなりから送ってもらう。
 */
/**
 * 返信の期日を日本語にする。
 * suggestedDueAt は入力欄用の "YYYY-MM-DDTHH:mm"。そのまま文面に入れると読めない。
 * 時刻までは求めない（相手はまだ取引の無い会社で、分単位の締切を押し付ける相手ではない）。
 */
function replyByLabel(dueAt: string | null): string | null {
  const matched = /^(\d{4})-(\d{2})-(\d{2})/.exec(dueAt ?? "");
  if (!matched) return null;
  const [, year, month, day] = matched;
  return `${year}年${Number(month)}月${Number(day)}日`;
}

// "use server" のファイルからは async 関数しか export できないため、初期値はこちらに置く
// （apps/web/AGENTS.md「実際に踏んだ落とし穴」）
const EMPTY_OUTREACH: OutreachState = {
  error: null,
  message: null,
  count: null,
  sample: [],
  listId: null,
  hasRemaining: false,
  quotaNote: null,
  killSwitchWarning: null,
};

/**
 * 営業AIでの開拓が使えないときの枠。
 *
 * 【消さずに理由を出す】
 * 枠ごと消すと、「そういう機能が無い」のか「設定していないだけ」なのかが
 * 利用者にも本部にも分からない。実際に「出ない」と言われて原因を追うことになった。
 * 押せない理由を書いておけば、本部に連絡すれば済むと分かる。
 */
function SalesAiUnavailable({ connected, trade }: { connected: boolean; trade: string }) {
  return (
    <div className="rounded border border-slate-200 bg-slate-50 px-2 py-1.5">
      <p className="text-xs font-medium text-slate-600">営業AIで新しい取引先を探して打診する</p>
      <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
        {connected
          ? `「${trade}」は、いまこの機能ではお探しできません。ご希望の場合は本部までご連絡ください。`
          : "いまはご利用いただけません。ご希望の場合は本部までご連絡ください。"}
      </p>
    </div>
  );
}

/**
 * 営業AIで候補企業を探して送る。
 *
 * 【依頼先がいても出す】（ユーザー決定 2026-08-29）
 * もともとは「協力会社がいない業種を埋める」機能として、依頼先が0社のときだけ
 * 出していた。相見積を増やしたい場合もあるので、常に出す。
 * ただし対応表に無い業種では出さない（呼び出し側で判定する）。
 *
 * 【押されたときだけ送る】
 * 件数を見る（preview）と、送信（リスト作成→送信）の2段。定期実行やジョブから
 * 呼ばない（CLAUDE.md「やらないこと：問い合わせフォームへの無人の自動送信」）。
 * 実際にフォームへ送るのは営業AIで、除外・上限・停止も営業AI側が持つ。
 *
 * 【対応表に無い業種では出さない】
 * 業種が変換できないまま投げると営業AI側で条件が捨てられ、その県の全社が対象になる。
 * 対応表は本部が設定する（/admin/accounts）。
 */
function SalesAiBlock({ tenderId, trade }: { tenderId: string; trade: string }) {
  const [state, formAction, pending] = useActionState(previewOutreachTargets, EMPTY_OUTREACH);
  const [sendState, sendFormAction, sending] = useActionState(sendOutreach, EMPTY_OUTREACH);
  const shown = sendState.message || sendState.error ? sendState : state;
  const found = state.count ?? 0;
  // 何社いるか見たときに止まっていると分かっていれば、送信ボタンは押させない
  // （営業AI側の送信自体は止まるが、押せてしまうと届かない理由が分かりにくい）
  const stopped = state.killSwitchWarning !== null;

  return (
    <div className="rounded border border-violet-200 bg-violet-50 px-2 py-1.5">
      <p className="text-xs font-medium text-violet-900">
        営業AIで新しい取引先を探して打診する
      </p>
      <p className="mt-0.5 text-xs leading-relaxed text-slate-600">
        まだ取引の無い会社に、この案件で見積を出せるかを問い合わせます。
        返信をもらった会社は、下の「送った会社を見る」から協力会社として登録できます。
      </p>
      <div className="mt-1 flex flex-wrap gap-2">
        <form action={formAction}>
          <input type="hidden" name="tender_id" value={tenderId} />
          <input type="hidden" name="trade" value={trade} />
          <button type="submit" disabled={pending} className={btnClass("default", "sm")}>
            {pending ? "問い合わせ中..." : "何社いるか見る"}
          </button>
        </form>

        {/* 何社いるかを見てからでないと送れない。件数を知らずに送らせない。
            送り残しがあるときは、もう一度押せるようにボタンを出したままにする
            （営業AIは1回に50社までしか送らない。送信済みの会社には送らない） */}
        {found > 0 && !stopped && (!sendState.message || sendState.hasRemaining) && (
          <form action={sendFormAction}>
            <input type="hidden" name="tender_id" value={tenderId} />
            <input type="hidden" name="trade" value={trade} />
            <ConfirmSubmitButton
              className={btnClass("primary", "sm")}
              disabled={sending}
              confirmMessage={
                sendState.hasRemaining
                  ? `まだ送れていない会社へ、${trade}のお取引の打診を送ります。送信は取り消せません。よろしいですか。`
                  : `${found}社の問い合わせフォームへ、${trade}のお取引の打診を送ります。送信は取り消せません。よろしいですか。`
              }
            >
              {sending ? "送信中..." : sendState.hasRemaining ? "続きを送信する" : `${found}社へ送信する`}
            </ConfirmSubmitButton>
          </form>
        )}
      </div>

      {shown.error && (
        <p role="alert" className="mt-1 text-xs leading-relaxed text-rose-700">
          {shown.error}
        </p>
      )}
      {shown.message && <p className="mt-1 text-xs leading-relaxed text-violet-900">{shown.message}</p>}
      {shown.killSwitchWarning && (
        <p role="alert" className="mt-1 text-xs leading-relaxed text-rose-700">
          {shown.killSwitchWarning}
        </p>
      )}
      {shown.quotaNote && <p className="mt-1 text-xs leading-relaxed text-slate-500">{shown.quotaNote}</p>}
      {state.sample.length > 0 && !sendState.message && (
        <ul className="mt-1 space-y-0.5">
          {state.sample.map((company, i) => (
            <li key={`${company.name}-${i}`} className="text-xs text-slate-600">
              ・{company.name}
              {company.pref && <span className="ml-1 text-slate-400">{company.pref}</span>}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-1 text-xs leading-relaxed text-slate-500">
        送るのは下の打診文です。実際にフォームへ送るのは営業AIで、送信先の除外・回数の上限・
        停止の設定はすべて営業AI側の設定が効きます。
      </p>
    </div>
  );
}

// "use server" のファイルからは async 関数しか export できないため、初期値はこちらに置く
const EMPTY_RESULTS: OutreachResultsState = { error: null, message: null, companies: [] };
const EMPTY_REGISTER: RegisterPartnerState = { error: null, message: null };

/**
 * 打診に返信をくれた会社を、協力会社として登録する1行。
 *
 * 【なぜ「返信のあった会社」を営業AIから引かないか】
 * 営業AIの replied は人が手で立てるフラグで、営業AIはメールボックスを見ていない。
 * 返信は打診文に書いた連絡先＝利用者自身のメールに届くので、
 * 「送った会社」を出して、返信をもらった会社を利用者に選んでもらう。
 */
function OutreachResultRow({
  tenderId,
  trade,
  company,
}: {
  tenderId: string;
  trade: string;
  company: OutreachResultsState["companies"][number];
}) {
  const [state, formAction, pending] = useActionState(registerPartnerFromOutreach, EMPTY_REGISTER);
  const done = Boolean(state.message);

  return (
    <li className="border-b border-violet-100 py-1 last:border-0">
      <form action={formAction} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="tender_id" value={tenderId} />
        <input type="hidden" name="trade" value={trade} />
        <input type="hidden" name="company_id" value={String(company.companyId)} />
        <input type="hidden" name="name" value={company.name} />
        <input type="hidden" name="pref" value={company.pref ?? ""} />
        <input type="hidden" name="tel" value={company.tel ?? ""} />
        <input type="hidden" name="email" value={company.email ?? ""} />
        <input type="hidden" name="contact_url" value={company.contactUrl ?? ""} />
        <input type="hidden" name="website_url" value={company.websiteUrl ?? ""} />

        <span className="text-xs text-slate-800">{company.name}</span>
        {company.pref && <span className="text-xs text-slate-400">{company.pref}</span>}
        {/* メールアドレスが無い会社は登録できても見積依頼を出せない。先に見せる */}
        {!company.email && <span className="text-xs text-amber-700">メール未取得</span>}
        {company.replied && <span className="text-xs text-emerald-700">返信あり</span>}
        {!done && (
          <button type="submit" disabled={pending} className={btnClass("default", "sm")}>
            {pending ? "登録中..." : "協力会社として登録"}
          </button>
        )}
      </form>
      {state.error && (
        <p role="alert" className="text-xs leading-relaxed text-rose-700">
          {state.error}
        </p>
      )}
      {state.message && <p className="text-xs leading-relaxed text-emerald-800">{state.message}</p>}
    </li>
  );
}

/**
 * 営業AIへ送った会社の一覧。返信をもらった会社をここから協力会社にする。
 *
 * **ここが繋がって初めて開拓が価値になる。** 送っただけでは協力会社は増えない。
 *
 * 【開いた時点で自動的に読み込む】
 * 以前は「送った会社を見る」を押すまで何も出さなかった。送った会社が誰かを
 * 確かめるのにひと手間かかっていたので、この枠が出た時点（＝1回でも送っている）で
 * 自動的に読み込む。ボタンは「読み込み直す」——返信が来たあとに押し直す用に残す。
 */
function OutreachResults({ tenderId, trade, sentOnLabel }: { tenderId: string; trade: string; sentOnLabel: string | null }) {
  const [state, formAction, pending] = useActionState(loadOutreachResults, EMPTY_RESULTS);
  const loadedRef = useRef(false);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    const formData = new FormData();
    formData.set("tender_id", tenderId);
    formData.set("trade", trade);
    formData.set("sent_on", sentOnLabel ?? "");
    formAction(formData);
    // 開いた時点で1回だけ読み込む。tenderId/tradeが変わることは無い
    // （呼び出し元のPanelがgroup.tradeをkeyにしているため、このコンポーネント自体が
    // 作り直される）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mt-1 rounded border border-violet-200 bg-violet-50 px-2 py-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs font-medium text-violet-900">営業AIで打診した会社</p>
        {sentOnLabel && <span className="text-xs text-slate-500">最後の送信 {sentOnLabel}</span>}
        <form action={formAction}>
          <input type="hidden" name="tender_id" value={tenderId} />
          <input type="hidden" name="trade" value={trade} />
          <input type="hidden" name="sent_on" value={sentOnLabel ?? ""} />
          <button type="submit" disabled={pending} className={btnClass("default", "sm")}>
            {pending ? "確認中..." : "読み込み直す"}
          </button>
        </form>
      </div>

      {state.error && (
        <p role="alert" className="mt-1 text-xs leading-relaxed text-rose-700">
          {state.error}
        </p>
      )}
      {state.message && <p className="mt-1 text-xs leading-relaxed text-violet-900">{state.message}</p>}
      {state.companies.length > 0 && (
        <ul className="mt-1">
          {state.companies.map((company) => (
            <OutreachResultRow key={company.companyId || company.name} tenderId={tenderId} trade={trade} company={company} />
          ))}
        </ul>
      )}
      <p className="mt-1 text-xs leading-relaxed text-slate-500">
        返信は、打診文に書いたご自身のメールアドレスに届きます。
        返信をもらった会社を登録すると、次の案件から見積依頼を出せます。
      </p>
    </div>
  );
}

function OutreachBlock(props: {
  tenderId: string;
  trade: string;
  senderOrgName: string;
  senderContactName: string;
  senderContactEmail: string | null;
  tenderName: string;
  agencyName: string;
  place: string | null;
  termFrom: string | null;
  termTo: string | null;
  replyByLabel: string | null;
  sourceUrl: string | null;
}) {
  const { subject, body } = buildOutreachMessage({ ...props, replyByLabel: replyByLabel(props.replyByLabel) });
  return (
    <div className="mt-1 space-y-2">
      <p className="text-xs leading-relaxed text-slate-600">
        この業種に対応するメール登録済みの協力会社がありません。
        <Link href="/partners" className="ml-1 text-blue-800 underline">
          協力会社
        </Link>
        から登録するか、下の文面で新しい会社に打診してください。
      </p>

      <div className="rounded border border-slate-200 bg-slate-50 px-2 py-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-slate-700">打診文（コピーして使えます）</span>
          <CopyButton value={`${subject}\n\n${body}`} label="打診文" />
        </div>
        <p className="mt-1 text-xs text-slate-500">件名</p>
        <p className="text-xs text-slate-800">{subject}</p>
        <p className="mt-1 text-xs text-slate-500">本文</p>
        <pre className="mt-0.5 whitespace-pre-wrap font-mono text-xs text-slate-800">{body}</pre>
      </div>

      {/* 見積依頼の文面と違い、回答ページのURLも数量表も入れていない。
          面識の無い会社に配ってよいものではないため（packages/domain/src/partner_outreach.ts） */}
      <p className="text-xs leading-relaxed text-slate-500">
        見積依頼の文面とは別のものです。回答ページのURLと数量表の中身は入れていません
        （まだ取引の無い会社に渡すものではないため）。公告のURLだけを載せています。
      </p>
    </div>
  );
}

const initialState: SendQuoteRequestsState = { error: null, summary: null };
const input = "rounded border border-slate-300 bg-white px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-300";
// 都道府県のうち、地方区分（AREA_OPTIONS）と重複する値（北海道）はエリア絞り込みの選択肢から重複表示しない
const PREFECTURE_ONLY_OPTIONS = PREFECTURE_OPTIONS.filter((p) => !(AREA_OPTIONS as readonly string[]).includes(p));

// 協力会社が多い業種でも選びやすいよう、会社名・対応業種・エリアで絞り込める検索＋
// スクロール枠にする。フィルタで絞り込んでも項目自体はDOMに残す（hidden切替）ことで、
// 選択中に検索条件を変えてもチェック状態（フォームの値）が失われないようにしている。
// 対応業種・エリアが未登録の協力会社は、絞り込みで除外されないようにしている
// （データ未整備を理由に依頼先の候補から漏れないようにするため）。
function PartnerPicker({
  trade,
  candidates,
  recommended,
  onSelectedCountChange,
}: {
  trade: string;
  candidates: RequestTabPartner[];
  recommended: Record<string, string>;
  /** 送信ボタンに「何社へ送るか」を出すため、選択数を親へ伝える */
  onSelectedCountChange: (trade: string, count: number) => void;
}) {
  const [query, setQuery] = useState("");
  const [tradeOnly, setTradeOnly] = useState(true);
  const [area, setArea] = useState("");
  const [selectedCount, setSelectedCount] = useState(0);
  const q = query.trim().toLowerCase();

  const matches = (p: RequestTabPartner) => {
    if (q && !`${p.name}${p.base ?? ""}`.toLowerCase().includes(q)) return false;
    if (tradeOnly && p.trades.length > 0 && !p.trades.includes(trade)) return false;
    if (area && p.areas.length > 0 && !p.areas.includes(area)) return false;
    return true;
  };
  const visibleCount = candidates.filter(matches).length;
  const noMatch = visibleCount === 0;
  const listRef = useRef<HTMLDivElement>(null);

  // チェックボックスは非制御（フォーム送信時の値をそのまま使うため）で、選択数もこのref経由で
  // 数え直す（ボタンでのDOM直接操作はchangeイベントを発火しないため、都度手動で更新する）。
  function updateSelectedCount() {
    const count = listRef.current?.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked').length ?? 0;
    setSelectedCount(count);
    onSelectedCountChange(trade, count);
  }

  // 「表示中の全社を選択」はDOMを直接操作する。hiddenが付いていない
  // （＝絞り込みに一致している）labelの中のcheckboxだけを対象にする。
  function selectAllVisible() {
    listRef.current?.querySelectorAll<HTMLInputElement>('label:not(.hidden) input[type="checkbox"]').forEach((el) => {
      el.checked = true;
    });
    updateSelectedCount();
  }

  // 絞り込みで隠れているチェックも含めて、この業種の選択を全て解除する
  function resetAll() {
    listRef.current?.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((el) => {
      el.checked = false;
    });
    updateSelectedCount();
  }

  // 絞り込みに関わらず、AIのおすすめ（recommendedのキーにある会社）だけを選択する
  function selectRecommended() {
    listRef.current?.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((el) => {
      el.checked = Boolean(recommended[el.value]);
    });
    updateSelectedCount();
  }

  return (
    <div className="mt-1">
      {candidates.length > 6 && (
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="会社名で絞り込み"
          className={`${input} mb-1.5 block w-full`}
        />
      )}
      <div className="mb-1.5 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1 text-xs text-slate-600">
          <input type="checkbox" checked={tradeOnly} onChange={(e) => setTradeOnly(e.target.checked)} />
          対応業種（{trade}）のみ表示
        </label>
        <label className="flex items-center gap-1 text-xs text-slate-600">
          エリア
          <select value={area} onChange={(e) => setArea(e.target.value)} className={input}>
            <option value="">指定なし</option>
            <optgroup label="地方区分">
              {AREA_OPTIONS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </optgroup>
            <optgroup label="都道府県">
              {PREFECTURE_ONLY_OPTIONS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
        <span className="text-xs text-slate-400">
          {visibleCount}社を表示中（全{candidates.length}社）
        </span>
        <span className="text-xs font-medium text-blue-800">{selectedCount}社を選択中</span>
        {visibleCount > 0 && (
          <button
            type="button"
            onClick={selectAllVisible}
            className="rounded border border-slate-300 bg-white px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-50"
          >
            表示中の全社を選択
          </button>
        )}
        {candidates.length > 0 && (
          <button
            type="button"
            onClick={resetAll}
            className="rounded border border-slate-300 bg-white px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-50"
          >
            リセット
          </button>
        )}
        {Object.keys(recommended).length > 0 && (
          <button
            type="button"
            onClick={selectRecommended}
            className="rounded border border-violet-300 bg-violet-50 px-2 py-0.5 text-xs text-violet-700 hover:bg-violet-100"
          >
            AIのおすすめを選択
          </button>
        )}
      </div>
      <div
        ref={listRef}
        onChange={updateSelectedCount}
        className="max-h-48 space-y-0.5 overflow-y-auto rounded border border-slate-100 p-1"
      >
        {noMatch && <p className="px-1.5 py-1 text-xs text-slate-400">該当する協力会社がありません</p>}
        {candidates.map((p) => (
          <label
            key={p.id}
            className={`flex items-center gap-1.5 rounded px-1.5 py-1 text-xs text-slate-700 hover:bg-slate-50 ${matches(p) ? "" : "hidden"}`}
          >
            <input type="checkbox" name={`partners_${trade}`} value={p.id} />
            {p.name}
            {recommended[p.id] && <Pill tone="violet">AIのおすすめ</Pill>}
            {p.base && <span className="text-slate-400">（{p.base}）</span>}
            {p.trades.length > 0 && <span className="text-slate-400">・{p.trades.join("／")}</span>}
            {p.areas.length > 0 && <span className="text-slate-400">・{p.areas.join("／")}</span>}
          </label>
        ))}
      </div>
    </div>
  );
}

export function RequestTab({
  tenderId,
  senderOrgName,
  senderContactName,
  senderContactEmail,
  tenderName,
  agencyName,
  place,
  termFrom,
  termTo,
  sourceUrl,
  lots,
  partners,
  suggestedDueAt,
  officialStatus,
  recommendations,
  outreachConnected,
  outreachTrades,
  outreachSends,
}: {
  tenderId: string;
  senderOrgName: string;
  senderContactName: string;
  senderContactEmail: string | null;
  tenderName: string;
  agencyName: string;
  place: string | null;
  termFrom: string | null;
  termTo: string | null;
  sourceUrl: string | null;
  lots: QuoteRequestLot[];
  partners: RequestTabPartner[];
  suggestedDueAt: string | null;
  officialStatus: "未取得" | "申請中" | "取得済";
  recommendations: Record<string, PartnerRecommendationResult | null>;
  /** 営業AIの接続そのものがあるか。無ければ業種以前に使えない */
  outreachConnected: boolean;
  /** 営業AIの対応表にある業種。ここに無い業種では候補を探せない */
  outreachTrades: string[];
  /**
   * すでに営業AIへ送った業種と、最後に送信した日時の表示。
   * 一度でも送っていれば、依頼先が埋まったあとも結果を見られるようにする
   * （返信は数日後に来るし、1社登録しただけで一覧が消えては困る）
   */
  outreachSends: Record<string, string | null>;
}) {
  const boundAction = sendQuoteRequests.bind(null, tenderId);
  const [state, formAction, pending] = useActionState(boundAction, initialState);
  const lotGroups = groupLotsByTrade(lots);
  // 数量表から切り出せなかった業種を、利用者が自分で足せるようにする
  const [manualTrades, setManualTrades] = useState<string[]>([]);
  const lotTrades = new Set(lotGroups.map((g) => g.trade));
  const addableTrades = TRADE_OPTIONS.filter((t) => !lotTrades.has(t));
  const tradeGroups: { trade: string; lots: typeof lots }[] = [
    ...lotGroups,
    ...manualTrades.filter((t) => !lotTrades.has(t)).map((trade) => ({ trade, lots: [] as typeof lots })),
  ];

  const toggleTrade = (trade: string) => {
    setManualTrades((prev) => (prev.includes(trade) ? prev.filter((t) => t !== trade) : [...prev, trade]));
  };

  // 送信ボタンに「何社へ送るか」を出す。同じ会社を複数の業種で選んだ場合は、
  // 業種ごとに1通ずつ送られるので、通数として数える。
  const [selectedByTrade, setSelectedByTrade] = useState<Record<string, number>>({});
  const handleSelectedCountChange = useCallback((trade: string, count: number) => {
    setSelectedByTrade((prev) => (prev[trade] === count ? prev : { ...prev, [trade]: count }));
  }, []);
  const totalSelected = tradeGroups.reduce((sum, g) => sum + (selectedByTrade[g.trade] ?? 0), 0);

  if (officialStatus !== "取得済") {
    return (
      <Panel title="見積依頼">
        <p className="text-xs text-slate-700">
          協力会社への見積依頼は、御社による資料の正式取得（取得済）が完了してから送信できます。
        </p>
        <p className="mt-1 text-xs text-slate-500">
          現在の状況：<Pill tone={officialStatus === "申請中" ? "amber" : "rose"}>{officialStatus}</Pill>
        </p>
        <Link href={`/tenders/${tenderId}?tab=docs`} className="mt-2 inline-block text-xs text-blue-800 underline">
          「資料」タブで正式取得の手順を確認する
        </Link>
      </Panel>
    );
  }

  return (
    <form action={formAction} className="space-y-3">
        <Panel title="依頼する業種">
          {lotGroups.length === 0 ? (
            <p className="text-xs leading-relaxed text-slate-600">
              この案件には数量表がありません。依頼する業種を選ぶと、見積依頼を作成できます。
              内訳の代わりに「公告資料をご確認のうえお見積りをお願いします」と依頼文に入ります。
            </p>
          ) : (
            <p className="text-xs leading-relaxed text-slate-600">
              数量表から{lotGroups.map((g) => g.trade).join("・")}を切り出しました。
              数量表に無い業種も、下から選んで依頼できます。
            </p>
          )}
          <div className="mt-2 flex flex-wrap gap-1">
            {addableTrades.map((trade) => (
              <label
                key={trade}
                className={`cursor-pointer rounded border px-2 py-1 text-xs ${
                  manualTrades.includes(trade)
                    ? "border-blue-700 bg-blue-50 font-medium text-blue-900"
                    : "border-slate-300 text-slate-600 hover:bg-slate-50"
                }`}
              >
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={manualTrades.includes(trade)}
                  onChange={() => toggleTrade(trade)}
                />
                {trade}
              </label>
            ))}
          </div>
        </Panel>

        {tradeGroups.map((group) => {
          const candidates = partners.filter((p) => p.email);
          const rec = recommendations[group.trade] ?? null;
          const recommendedMap = Object.fromEntries((rec?.recommendations ?? []).map((r) => [r.partner_id, r.reason]));
          const { body } = buildQuoteRequestEmail({
            senderOrgName,
            senderContactName,
            senderContactEmail,
            tenderName,
            agencyName,
            place,
            termFrom,
            termTo,
            dueAtLabel: DUE_AT_PLACEHOLDER,
            trade: group.trade,
            lots: group.lots,
            responseUrl: RESPONSE_URL_PLACEHOLDER,
          });
          return (
            <Panel
              key={group.trade}
              title={group.lots.length > 0 ? `${group.trade}（数量表 ${group.lots.length}行）` : `${group.trade}（数量表なし）`}
            >
              {rec && rec.recommendations.length > 0 && (
                <div className="mb-2 rounded border border-violet-200 bg-violet-50 px-2 py-1.5">
                  <p className="text-xs font-medium text-violet-800">AIのおすすめ</p>
                  <ul className="mt-1 space-y-0.5">
                    {rec.recommendations.map((r) => {
                      const partner = partners.find((p) => p.id === r.partner_id);
                      if (!partner) return null;
                      return (
                        <li key={r.partner_id} className="text-xs text-violet-900">
                          ・{partner.name}：<TruncatedText text={r.reason} />
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
              {rec?.unavailableReason && (
                <p className="mb-2 text-xs text-slate-400">AIによるおすすめは取得できませんでした（{rec.unavailableReason}）</p>
              )}
              {rec && rec.recommendations.length === 0 && !rec.unavailableReason && rec.note && (
                <p className="mb-2 text-xs text-slate-400">
                  AIのおすすめ：<TruncatedText text={rec.note} limit={50} />
                </p>
              )}
              <div className="text-xs font-medium text-slate-700">依頼先</div>
              {candidates.length === 0 ? (
                <OutreachBlock
                  tenderId={tenderId}
                  trade={group.trade}
                  senderOrgName={senderOrgName}
                  senderContactName={senderContactName}
                  senderContactEmail={senderContactEmail}
                  tenderName={tenderName}
                  agencyName={agencyName}
                  place={place}
                  termFrom={termFrom}
                  termTo={termTo}
                  replyByLabel={suggestedDueAt}
                  sourceUrl={sourceUrl}
                />
              ) : (
                <PartnerPicker
                  trade={group.trade}
                  candidates={candidates}
                  recommended={recommendedMap}
                  onSelectedCountChange={handleSelectedCountChange}
                />
              )}

              {/* 【依頼先がいても出す】（ユーザー決定 2026-08-29）
                  もともとは「協力会社がいない業種を埋める」機能として、依頼先が0社のときだけ
                  出していた。相見積を増やしたい場合もあるので、常に出す。

                  【使えないときも枠は出す】
                  対応表に無い業種では探しに行けない（その県の全社が対象になってしまうため）。
                  ただし枠ごと消すと、機能が無いのか設定していないのかが分からない。
                  枠は出したまま、押せない理由を書く */}
              {outreachTrades.includes(group.trade) ? (
                <SalesAiBlock tenderId={tenderId} trade={group.trade} />
              ) : (
                <SalesAiUnavailable connected={outreachConnected} trade={group.trade} />
              )}

              {/* 依頼先が埋まったあとも出す。1社登録したら一覧が消える、では続きを登録できない */}
              {group.trade in outreachSends && (
                <OutreachResults
                  tenderId={tenderId}
                  trade={group.trade}
                  sentOnLabel={outreachSends[group.trade]}
                />
              )}

              <label className="mt-3 block text-xs">
                <span className="font-medium text-slate-700">依頼文（編集できます）</span>
                <textarea name={`body_${group.trade}`} defaultValue={body} rows={8} className={`${input} mt-1 block w-full font-mono`} />
              </label>
            </Panel>
          );
        })}

        <Panel title="回答期限">
          <label className="flex flex-wrap items-center gap-2 text-xs">
            <input type="datetime-local" name="due_at" defaultValue={suggestedDueAt ?? ""} required className={input} />
            <span className="text-slate-500">期限の24時間前に未回答の会社へ自動で催促します（1社につき1回だけ）。</span>
          </label>
        </Panel>

        {state.error && (
          <p role="alert" className="text-xs text-rose-700">
            {state.error}
          </p>
        )}
        {state.summary && <p className="text-xs text-emerald-700">{state.summary}</p>}

        <div className="flex flex-wrap items-center gap-2">
          <ConfirmSubmitButton
            confirmMessage={
              totalSelected > 0
                ? `${totalSelected}社へ本当にメールを送信します。よろしいですか？`
                : "選択した協力会社へ本当にメールを送信します。よろしいですか？"
            }
            disabled={pending || totalSelected === 0}
            className="rounded border border-blue-800 bg-blue-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-900 disabled:opacity-40"
          >
            {pending ? "送信中..." : totalSelected > 0 ? `${totalSelected}社へ見積依頼を送信する` : "見積依頼を送信する"}
          </ConfirmSubmitButton>
          <Pill tone="amber">実際にメールが送信されます</Pill>
          {totalSelected === 0 && <span className="text-xs text-slate-500">依頼先を1社以上選んでください</span>}
        </div>
      </form>
  );
}
