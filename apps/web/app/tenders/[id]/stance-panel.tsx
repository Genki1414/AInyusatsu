"use client";

// 案件ごとの「参加するかどうか」と、参加を決めたあとの段取り。
//
// 【上に置く】
// 案件を開いてまず決めるのは「やるかどうか」。タブの中に埋めると、
// 決めないまま資料や見積を見に行くことになる。
//
// 【参加を決めたときだけ段取りを出す】
// 検討・保留の段階で「あと3日」と急かしても、やることが決まっていない。
// 参加と決めた案件にだけ、次に何をするかを出す。

import { useActionState } from "react";
import Link from "next/link";
import {
  deadlineLabel,
  isUrgent,
  SELECTABLE_STANCES,
  type RoadmapStep,
  type TenderStance,
} from "@ai-nyusatsu-bu/domain";
import { btnClass, Panel, Pill } from "@/components/ui";
import { setTenderStance, type StanceState } from "./stance-actions";

// "use server" のファイルからは async 関数しか export できないため、初期値はこちらに置く
// （apps/web/AGENTS.md「実際に踏んだ落とし穴」）
const EMPTY: StanceState = { error: null, message: null };

const TONE: Record<TenderStance, "green" | "amber" | "slate" | "rose"> = {
  参加: "green",
  検討: "amber",
  保留: "slate",
  未定: "slate",
  見送り: "rose",
};

function StepMark({ state }: { state: RoadmapStep["state"] }) {
  if (state === "済") return <span className="text-xs text-emerald-700">済</span>;
  if (state === "いま") return <span className="text-xs font-semibold text-blue-800">いま</span>;
  return <span className="text-xs text-slate-400">—</span>;
}

/** 段取り1行。期限が取れていないものは日付を出さない（推測しない）。 */
function Step({ step, tenderId }: { step: RoadmapStep; tenderId: string }) {
  const current = step.state === "いま";
  return (
    <li
      className={`flex flex-wrap items-baseline gap-2 border-b border-slate-100 py-1.5 last:border-0 ${
        step.state === "これから" ? "text-slate-400" : ""
      }`}
    >
      <span className="w-8 shrink-0">
        <StepMark state={step.state} />
      </span>
      <span className={`text-xs ${current ? "font-semibold text-slate-900" : "text-slate-700"}`}>{step.label}</span>
      <span className={`text-xs ${isUrgent(step.daysLeft) ? "font-medium text-rose-700" : "text-slate-500"}`}>
        {deadlineLabel(step.daysLeft)}
      </span>
      {current && <span className="w-full text-xs leading-relaxed text-slate-600">{step.note}</span>}
      {current && <StepLink label={step.label} tenderId={tenderId} />}
    </li>
  );
}

/** いまやる段取りから、その作業のタブへ直接飛ばす。探させない。 */
function StepLink({ label, tenderId }: { label: string; tenderId: string }) {
  const tab =
    label.includes("名義で取得") || label.includes("質問")
      ? "docs"
      : label.includes("見積を依頼")
        ? "request"
        : label.includes("応札価格")
          ? "cost"
          : label.includes("提出書類") || label.includes("入札書")
            ? "forms"
            : null;
  if (tab === null) return null;
  return (
    <Link href={`/tenders/${tenderId}?tab=${tab}`} className="text-xs text-blue-800 underline">
      この作業へ
    </Link>
  );
}

export function StancePanel({
  tenderId,
  stance,
  steps,
}: {
  tenderId: string;
  stance: TenderStance;
  /** 参加のときだけ中身が入る */
  steps: RoadmapStep[];
}) {
  const [state, formAction, pending] = useActionState(setTenderStance, EMPTY);

  return (
    <Panel
      title="この案件をどうするか"
      right={<Pill tone={TONE[stance]}>{stance}</Pill>}
    >
      <form action={formAction} className="flex flex-wrap items-center gap-1.5">
        <input type="hidden" name="tender_id" value={tenderId} />
        {SELECTABLE_STANCES.map((option) => (
          <button
            key={option}
            type="submit"
            name="stance"
            value={option}
            disabled={pending || option === stance}
            className={btnClass(option === stance ? "primary" : "default", "sm")}
          >
            {option === "見送り" ? "見送る" : option}
          </button>
        ))}
        {stance === "未定" && <span className="text-xs text-slate-500">まだ決めていません</span>}
      </form>

      {state.error && (
        <p role="alert" className="mt-1 text-xs leading-relaxed text-rose-700">
          {state.error}
        </p>
      )}
      {state.message && <p className="mt-1 text-xs leading-relaxed text-emerald-800">{state.message}</p>}

      {stance === "参加" && steps.length > 0 && (
        <div className="mt-3 border-t border-slate-200 pt-2">
          <p className="text-xs font-medium text-slate-700">提出までの段取り</p>
          <ul className="mt-1">
            {steps.map((step) => (
              <Step key={step.label} step={step} tenderId={tenderId} />
            ))}
          </ul>
          <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
            期限は本サービスの解析結果です。
            <span className="font-medium text-slate-700">必ず公告の原本でご確認ください。</span>
          </p>
        </div>
      )}
    </Panel>
  );
}
