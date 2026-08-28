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
import { useActionState, useCallback, useRef, useState } from "react";
import Link from "next/link";
import { ConfirmSubmitButton } from "@/components/ConfirmSubmitButton";
import { CopyButton } from "@/components/CopyButton";
import { Panel, Pill } from "@/components/ui";
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

function OutreachBlock(props: {
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
            <span className="text-slate-500">期限の24時間前に未回答の会社へ自動で催促します（タスク4-4で実装予定）。</span>
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
