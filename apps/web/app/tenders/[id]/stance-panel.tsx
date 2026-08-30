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

import { Check } from "lucide-react";
import { useActionState, useState } from "react";
import Link from "next/link";
import {
  amountLabel,
  deadlineDate,
  isDeadlineNear,
  isWon,
  remainingText,
  SELECTABLE_BID_RESULTS,
  SELECTABLE_STANCES,
  type BidResult,
  type RoadmapStep,
  type TenderStance,
} from "@ai-nyusatsu-bu/domain";
import { btnClass, Panel, Pill } from "@/components/ui";
import {
  setBidResult,
  setTenderStance,
  toggleRoadmapStep,
  type BidResultState,
  type RoadmapState,
  type StanceState,
} from "./stance-actions";

// "use server" のファイルからは async 関数しか export できないため、初期値はこちらに置く
// （apps/web/AGENTS.md「実際に踏んだ落とし穴」）
const EMPTY: StanceState = { error: null, message: null };
const EMPTY_RESULT: BidResultState = { error: null, message: null };
const EMPTY_ROADMAP: RoadmapState = { error: null, message: null };

const input =
  "rounded border border-slate-300 bg-white px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-300";

const TONE: Record<TenderStance, "green" | "amber" | "slate" | "rose"> = {
  参加: "green",
  検討: "amber",
  保留: "slate",
  未定: "slate",
  見送り: "rose",
};

/**
 * やったかどうかのチェック（ユーザー要望 2026-08-31）。
 *
 * 【本サービスが知っている段取りは押せなくする】
 * 見積依頼を送った等、記録で終わったと分かるものは、外させない。
 * 画面が記録に反することを書くと、どちらが本当か分からなくなる。
 * なぜ押せないかは、その場に文で出す（黙って効かないボタンにしない）。
 *
 * 【JSが無くても動く】
 * チェックボックスの見た目のボタンをformで送る。onChangeで送る作りだと、
 * 読み込み中に押した分が消える。
 */
function StepCheck({
  step,
  tenderId,
}: {
  step: RoadmapStep;
  tenderId: string;
}) {
  const [state, formAction, pending] = useActionState(toggleRoadmapStep, EMPTY_ROADMAP);
  const done = step.state === "済";
  const locked = step.lockedReason !== null;

  const box = (
    <span
      className={`flex h-4 w-4 items-center justify-center rounded border ${
        done
          ? locked
            ? "border-emerald-600 bg-emerald-600/60"
            : "border-emerald-600 bg-emerald-600"
          : "border-slate-400 bg-white"
      } ${pending ? "opacity-50" : ""}`}
    >
      {done && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
    </span>
  );

  if (locked) {
    return (
      <span className="flex h-4 w-4 items-center justify-center" title={step.lockedReason ?? undefined}>
        {box}
      </span>
    );
  }

  return (
    <form action={formAction} className="flex items-center">
      <input type="hidden" name="tender_id" value={tenderId} />
      <input type="hidden" name="step" value={step.key} />
      <input type="hidden" name="checked" value={done ? "0" : "1"} />
      <button
        type="submit"
        role="checkbox"
        aria-checked={done}
        aria-label={done ? `${step.label}（やった）を取り消す` : `${step.label}をやったことにする`}
        disabled={pending}
        className="flex items-center rounded focus:outline-none focus:ring-2 focus:ring-blue-300"
      >
        {box}
      </button>
      {state.error && <span className="sr-only">{state.error}</span>}
    </form>
  );
}

/**
 * 段取り1行。
 *
 * 【日付と残り日数を必ず並べる】
 * 「あと2日」だけでは、いつが締切かを自分で数えることになる（ユーザー要望 2026-08-31）。
 * 日付だけでは急ぎかどうかが一目で分からない。両方を出す。
 * **期限が取れていない段取りは日付を作らない**（推測しない）。
 */
function Step({ step, tenderId }: { step: RoadmapStep; tenderId: string }) {
  const current = step.state === "いま";
  const date = deadlineDate(step.deadline);
  return (
    <li
      className={`flex flex-wrap items-baseline gap-2 border-b border-slate-100 py-1.5 last:border-0 ${
        step.state === "これから" ? "text-slate-400" : ""
      }`}
    >
      <span className="shrink-0 self-center">
        <StepCheck step={step} tenderId={tenderId} />
      </span>
      <span className={`text-xs ${current ? "font-semibold text-slate-900" : "text-slate-700"}`}>{step.label}</span>
      {/* やらずに進める段取りだと分かるようにする。ここで止まらせない */}
      {step.optional && <span className="text-xs text-slate-400">任意</span>}
      {current && <span className="text-xs font-semibold text-blue-800">いま</span>}
      {date !== null && <span className="text-xs tabular-nums text-slate-600">{date}</span>}
      <span className={`text-xs ${isDeadlineNear(step.daysLeft) ? "font-medium text-rose-700" : "text-slate-500"}`}>
        {remainingText(step.daysLeft)}
      </span>
      {/* なぜ押せないかを、その場に出す（黙って効かないチェックにしない） */}
      {step.lockedReason !== null && (
        <span className="text-xs text-slate-400">{step.lockedReason}</span>
      )}
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

/**
 * 入札の結果を記録する。
 *
 * 【なぜ人が入れるか】
 * 開札の結果は発注機関が公表するが、形も時期も機関ごとにばらばらで自動では拾えない。
 * 取れないものを取れたことにしない（CLAUDE.md 最重要の前提7）。
 *
 * 【金額のラベルは結果で変わる】
 * 落札なら御社の金額、落札できずなら他社の金額。どちらも次の応札価格の材料になる。
 * 辞退・中止では、決まった金額が無いので入力欄を出さない。
 */
function BidResultForm({
  tenderId,
  result,
  amount,
  memo,
}: {
  tenderId: string;
  result: BidResult;
  amount: number | null;
  memo: string | null;
}) {
  const [state, formAction, pending] = useActionState(setBidResult, EMPTY_RESULT);
  const [selected, setSelected] = useState<BidResult>(result === "未入力" ? "落札" : result);
  const label = amountLabel(selected);

  return (
    <div className="mt-3 border-t border-slate-200 pt-2">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs font-medium text-slate-700">入札の結果</p>
        {result !== "未入力" && (
          <Pill tone={isWon(result) ? "green" : "slate"}>{result}</Pill>
        )}
        {result !== "未入力" && amount !== null && (
          <span className="text-xs text-slate-600">{amount.toLocaleString("ja-JP")}円</span>
        )}
      </div>

      <form action={formAction} className="mt-1.5 flex flex-wrap items-end gap-2">
        <input type="hidden" name="tender_id" value={tenderId} />
        <label className="flex flex-col gap-0.5 text-xs">
          <span className="text-slate-500">結果</span>
          <select
            name="bid_result"
            value={selected}
            onChange={(e) => setSelected(e.target.value as BidResult)}
            className={`${input} w-36`}
          >
            {SELECTABLE_BID_RESULTS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>

        {/* 辞退・中止では金額を出さない。決まった金額が無いのに数字が残ると、
            あとで相場の材料として読み違える */}
        {label !== null && (
          <label className="flex flex-col gap-0.5 text-xs">
            <span className="text-slate-500">{label}</span>
            <input
              type="text"
              inputMode="numeric"
              name="result_amount"
              defaultValue={amount === null ? "" : String(amount)}
              placeholder="円"
              className={`${input} w-40`}
            />
          </label>
        )}

        <label className="flex flex-col gap-0.5 text-xs">
          <span className="text-slate-500">覚え書き（任意）</span>
          <input
            type="text"
            name="result_memo"
            defaultValue={memo ?? ""}
            placeholder="何位だったか、辞退の理由など"
            className={`${input} w-64`}
          />
        </label>

        <button type="submit" disabled={pending} className={btnClass("primary", "sm")}>
          {pending ? "保存中..." : result === "未入力" ? "結果を記録する" : "結果を直す"}
        </button>
      </form>

      {state.error && (
        <p role="alert" className="mt-1 text-xs leading-relaxed text-rose-700">
          {state.error}
        </p>
      )}
      {state.message && <p className="mt-1 text-xs leading-relaxed text-emerald-800">{state.message}</p>}
      <p className="mt-1 text-xs leading-relaxed text-slate-500">
        結果は自動では分かりません（機関ごとに公表の形が違うため）。開札のあとにご入力ください。
        入れておくと、次に似た案件の応札価格を決めるときの材料になります。
      </p>
    </div>
  );
}

export function StancePanel({
  tenderId,
  stance,
  steps,
  result,
  resultAmount,
  resultMemo,
  canEnterResult,
}: {
  tenderId: string;
  stance: TenderStance;
  /** 参加のときだけ中身が入る */
  steps: RoadmapStep[];
  result: BidResult;
  resultAmount: number | null;
  resultMemo: string | null;
  /** 開札の日を過ぎたか。過ぎる前は結果の欄を出さない */
  canEnterResult: boolean;
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

          {/* 開札の前に出すと、まだ分からないものを入れさせることになる。
              すでに入っている場合は、直せるように出したままにする */}
          {(canEnterResult || result !== "未入力") && (
            <BidResultForm tenderId={tenderId} result={result} amount={resultAmount} memo={resultMemo} />
          )}
        </div>
      )}
    </Panel>
  );
}
