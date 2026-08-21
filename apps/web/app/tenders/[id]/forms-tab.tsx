"use client";

// 提出書類チェックリスト（タスク4-6）。docs/ai-nyusatsu-bu-prototype-v7.jsx の FormsTab 相当。
// 文言はプロトタイプのものをそのまま使う（CLAUDE.md「表現を変えない」）。
//
// 「該当する場合のみ提出」の書類（tender_forms.required = false）は一覧に出すが、
// 提出可否の判定には含めない。該当しない書類を完了にしようが無く、含めると関係のない
// 書類のせいで提出済みにできなくなるため（プロトタイプには必須／任意の区別が無かった）。

import { useActionState } from "react";
import { CheckCircle2 } from "lucide-react";
import { checklistProgress, type ChecklistItem, type FormState, FORM_STATES } from "@ai-nyusatsu-bu/domain";
import { Bar, Panel, Pill, btnClass } from "@/components/ui";
import { markSubmitted, setFormState, type ChecklistActionState } from "./forms-actions";

const initialState: ChecklistActionState = { error: null };

function StatePill({ state }: { state: FormState }) {
  if (state === "完了") return <Pill tone="green">完了</Pill>;
  if (state === "作成中") return <Pill tone="amber">作成中</Pill>;
  return <Pill tone="slate">未着手</Pill>;
}

export function FormsTab({
  tenderId,
  items,
  submitDeadline,
  workStatus,
}: {
  tenderId: string;
  items: ChecklistItem[];
  submitDeadline: string | null;
  workStatus: string;
}) {
  const boundSubmit = markSubmitted.bind(null, tenderId);
  const [state, formAction, pending] = useActionState(boundSubmit, initialState);
  const progress = checklistProgress(items);
  const alreadySubmitted = workStatus === "提出済";

  if (items.length === 0) {
    return (
      <Panel title="提出書類">
        <p className="text-xs text-slate-600">様式の解析後に必要書類を一覧化します。</p>
      </Panel>
    );
  }

  return (
    <div className="space-y-3">
      <Panel
        title="提出書類チェックリスト"
        right={
          <span className="text-xs tabular-nums text-slate-500">
            {progress.done}/{progress.total}
          </span>
        }
      >
        <Bar value={progress.total === 0 ? 0 : (progress.done / progress.total) * 100} tone="bg-emerald-500" />
        <p className="mt-2 text-xs leading-relaxed text-slate-500">
          様式ファイルからAIが必要書類を抽出しました。1つでも欠けると失格になるため、提出前にすべて「完了」にしてください。
        </p>
        {progress.optional > 0 && (
          <p className="mt-1 text-xs text-slate-500">
            「任意」の書類{progress.optional}件は、該当する場合のみ提出します。提出済みにする判定には含めていません。
          </p>
        )}
        <p className="mt-2 text-xs text-slate-600">
          提出期限：
          {submitDeadline ? (
            <span className="tabular-nums">{new Date(submitDeadline).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}</span>
          ) : (
            <span className="text-slate-400">未確認</span>
          )}
        </p>
      </Panel>

      <Panel dense>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-500">
              <tr className="text-left">
                <th className="px-3 py-2 font-medium">書類</th>
                <th className="px-2 py-2 font-medium">様式</th>
                <th className="px-2 py-2 font-medium">状態</th>
                <th className="px-2 py-2 font-medium">AIからの補足</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {items.map((x) => (
                <tr key={x.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-medium">
                    {x.name}
                    {!x.required && (
                      <span className="ml-1.5">
                        <Pill tone="slate">任意</Pill>
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-2 text-slate-500">{x.source ?? "—"}</td>
                  <td className="px-2 py-2">
                    <StatePill state={x.state} />
                  </td>
                  <td className="px-2 py-2 text-slate-600">{x.note || <span className="text-slate-300">—</span>}</td>
                  <td className="px-2 py-2 text-right whitespace-nowrap">
                    <form action={setFormState.bind(null, tenderId, x.id)}>
                      <select
                        name="state"
                        defaultValue={x.state}
                        onChange={(e) => e.currentTarget.form?.requestSubmit()}
                        className="rounded border border-slate-300 bg-white px-1.5 py-1 text-xs text-slate-900"
                      >
                        {FORM_STATES.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="提出">
        <p className="text-xs leading-relaxed text-slate-600">
          書類が揃ったら、調達ポータル（電子調達システム）で入札書を提出します。提出後の取り下げはできません。
        </p>
        {state.error && <p className="mt-2 rounded bg-rose-50 px-2 py-1.5 text-xs text-rose-800">{state.error}</p>}
        <div className="mt-2 flex flex-wrap gap-2">
          {alreadySubmitted ? (
            <Pill tone="green">提出済</Pill>
          ) : (
            <form action={formAction}>
              <button type="submit" disabled={!progress.canSubmit || pending} className={btnClass("primary", "sm")}>
                <CheckCircle2 size={12} />
                {pending ? "記録しています…" : "提出済みにする"}
              </button>
            </form>
          )}
          {!alreadySubmitted && progress.remaining > 0 && (
            <span className="self-center text-xs text-slate-500">未完了の書類が {progress.remaining}件あります</span>
          )}
        </div>
      </Panel>
    </div>
  );
}
