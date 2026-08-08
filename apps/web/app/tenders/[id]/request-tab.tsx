"use client";

// 見積依頼。docs/ai-nyusatsu-bu-prototype-v7.jsx の RequestTab 相当。
//
// 業種ごとに数量表の該当行だけを切り出し、対象業種の協力会社（メール登録済みのみ）に
// チェックを入れて送信する。実際にメールが送信されるため、送信ボタンには確認ダイアログを
// 挟んでいる（components/ConfirmSubmitButton）。
//
// 御社による正式取得（company_tenders.official_status）が「取得済」になるまでは送信できない
// （docs/資料取得方針_v3.md §5「取得済みになるまで…作業を促さない」を見積依頼にも適用する。
// ユーザーからの明示的な要望による）。サーバー側（actions.ts）でも同じ判定をしている。
import { useActionState } from "react";
import Link from "next/link";
import { ConfirmSubmitButton } from "@/components/ConfirmSubmitButton";
import { Panel, Pill } from "@/components/ui";
import { buildQuoteRequestEmail, groupLotsByTrade, type QuoteRequestLot } from "@ai-nyusatsu-bu/domain";
import { sendQuoteRequests, type SendQuoteRequestsState } from "./actions";
import { DUE_AT_PLACEHOLDER } from "./quote-request-shared";

export type RequestTabPartner = { id: string; name: string; base: string | null; email: string | null };

const initialState: SendQuoteRequestsState = { error: null, summary: null };
const input = "rounded border border-slate-300 bg-white px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-300";

export function RequestTab({
  tenderId,
  senderOrgName,
  tenderName,
  agencyName,
  place,
  termFrom,
  termTo,
  lots,
  partners,
  suggestedDueAt,
  officialStatus,
}: {
  tenderId: string;
  senderOrgName: string;
  tenderName: string;
  agencyName: string;
  place: string | null;
  termFrom: string | null;
  termTo: string | null;
  lots: QuoteRequestLot[];
  partners: RequestTabPartner[];
  suggestedDueAt: string | null;
  officialStatus: "未取得" | "申請中" | "取得済";
}) {
  const boundAction = sendQuoteRequests.bind(null, tenderId);
  const [state, formAction, pending] = useActionState(boundAction, initialState);
  const tradeGroups = groupLotsByTrade(lots);

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

  if (tradeGroups.length === 0) {
    return (
      <Panel title="見積依頼">
        <p className="text-xs text-slate-500">数量表が無いため、見積依頼を作成できません。</p>
      </Panel>
    );
  }

  return (
    <form action={formAction} className="space-y-3">
      {tradeGroups.map((group) => {
        const candidates = partners.filter((p) => p.email);
        const { body } = buildQuoteRequestEmail({
          senderOrgName,
          tenderName,
          agencyName,
          place,
          termFrom,
          termTo,
          dueAtLabel: DUE_AT_PLACEHOLDER,
          trade: group.trade,
          lots: group.lots,
        });
        return (
          <Panel key={group.trade} title={`${group.trade}（数量表 ${group.lots.length}行）`}>
            <div className="text-xs font-medium text-slate-700">依頼先</div>
            {candidates.length === 0 ? (
              <p className="mt-1 text-xs text-slate-500">
                この業種に対応するメール登録済みの協力会社がありません。「協力会社」画面から登録してください。
              </p>
            ) : (
              <div className="mt-1 flex flex-wrap gap-2">
                {candidates.map((p) => (
                  <label key={p.id} className="flex items-center gap-1.5 rounded border border-slate-200 px-2 py-1 text-xs text-slate-700">
                    <input type="checkbox" name={`partners_${group.trade}`} value={p.id} />
                    {p.name}
                    {p.base && <span className="text-slate-400">（{p.base}）</span>}
                  </label>
                ))}
              </div>
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
          confirmMessage="選択した協力会社へ本当にメールを送信します。よろしいですか？"
          disabled={pending}
          className="rounded border border-blue-800 bg-blue-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-900 disabled:opacity-40"
        >
          {pending ? "送信中..." : "見積依頼を送信する"}
        </ConfirmSubmitButton>
        <Pill tone="amber">実際にメールが送信されます</Pill>
      </div>
    </form>
  );
}
