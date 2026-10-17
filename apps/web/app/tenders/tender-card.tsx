"use client";

// 案件一覧から直接、判断（検討 / 見送り）を記録する。見送った案件は1行に畳む。
//
// 【なぜ一覧に置くか】
// これまで判断は案件ページだけで押せた。1件ずつ開いて、下までスクロールして押して、
// 戻る。20件を振り分けると20往復になる。毎日使うのでここが一番の手数だった
// （ユーザー要望 2026-10-17「自社で使用するのに使い勝手をよくしたい」）。
//
// 【なぜ畳むのか。なぜ消さないのか】
// 振り分けても一覧が短くならないと、押した意味が見えない。
// かといって一覧から除くには、DB側で「company_tenders の行が無い案件（未定）」を
// 含めた反結合が必要になる。PostgREST の内部結合では未定の案件が消えてしまい、
// 見送りのIDを並べて除外する方法は、生きている案件が千件規模になるとURLが破綻する。
// 件数とページ送りを壊さずにやるなら、畳むのが確実。
// **畳んでも一覧からは消さない。** 件数もページ送りもこれまでどおりで、
// 「戻す」でその場に戻せる。
//
// 【「参加」はここに出さない】
// 参加を決めると提出までの段取りが始まる。資料の取得・見積依頼・書類の用意を
// いつまでにやるかを見ながら決めるものなので、案件ページで押す。
// 一覧は「残すか／落とすか」だけにする。
//
// 【押した瞬間に反映する】
// サーバーの応答を待ってから印を付けると、押しても何も起きない時間ができる。
// 段取りのチェックで同じことをやって混乱した（apps/web/AGENTS.md）。
// 先に画面を変えて、失敗したら戻す。

import type { ReactNode } from "react";
import { useState, useTransition } from "react";
import Link from "next/link";
import { ListChecks } from "lucide-react";
import { setStance } from "./[id]/stance-actions";
import { btnClass, Panel, StancePill } from "@/components/ui";

/** 一覧から選べる判断。参加は案件ページで決める（上のコメント参照）。 */
const CHOICES = [
  { stance: "検討", label: "検討する", title: "残して、あとで参加するか決める" },
  { stance: "見送り", label: "見送る", title: "この案件は参加しない" },
] as const;

const BUTTON = "rounded border px-2 py-1 text-xs disabled:opacity-40";

/**
 * 判断の保存をまとめて持つ。
 * 保存前に画面を変え、失敗したら元へ戻して理由を出す。
 */
function useStanceChoice(tenderId: string, saved: string | undefined) {
  const [stance, setStanceLocal] = useState<string | undefined>(saved);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function choose(next: string) {
    const before = stance;
    setStanceLocal(next);
    setError(null);
    startTransition(async () => {
      const result = await setStance(tenderId, next);
      if (result.error !== null) {
        setStanceLocal(before);
        setError(result.error);
      }
    });
  }

  return { stance, error, pending, choose };
}

/**
 * 一覧の1件。見送った案件は1行に畳む。
 *
 * 畳むかどうかは判断で決まるので、案件の中身（children）ごとこの中に入れる。
 * ボタンだけを別に置くと、押しても枠が残って畳めない。
 */
export function TenderCard({
  tenderId,
  tenderName,
  stance: saved,
  children,
}: {
  tenderId: string;
  tenderName: string;
  stance: string | undefined;
  children: ReactNode;
}) {
  const { stance, error, pending, choose } = useStanceChoice(tenderId, saved);

  if (stance === "見送り") {
    return (
      <Panel dense>
        <div className="flex flex-wrap items-center gap-2 px-3 py-2">
          <StancePill stance="見送り" />
          <Link prefetch={false} href={`/tenders/${tenderId}`} className="text-xs text-slate-600 hover:underline">
            {tenderName}
          </Link>
          <button
            type="button"
            onClick={() => choose("未定")}
            disabled={pending}
            title="判断を取り消して、一覧に戻す"
            className={`${BUTTON} ml-auto border-slate-300 bg-white text-slate-700 hover:bg-slate-50`}
          >
            戻す
          </button>
          {error !== null && (
            <span role="alert" className="text-xs text-rose-700">
              {error}
            </span>
          )}
        </div>
      </Panel>
    );
  }

  return (
    <Panel>
      {children}
      {/* 【一覧から振り分けられるようにする】
          1件ずつ開いて判断していると、20件で20往復になる。
          「案件を見る」と同じ行に置く（押す場所をまとめる） */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Link prefetch={false} href={`/tenders/${tenderId}`} className={btnClass("primary")}>
          <ListChecks size={12} />
          案件を見る
        </Link>
        <StanceChoices stance={stance} error={error} pending={pending} choose={choose} />
      </div>
    </Panel>
  );
}

function StanceChoices({
  stance,
  error,
  pending,
  choose,
}: {
  stance: string | undefined;
  error: string | null;
  pending: boolean;
  choose: (next: string) => void;
}) {
  // 【参加の案件はここから落とさない】
  // 参加にすると提出までの段取りが始まる。資料を取り、見積を集め、書類をそろえている
  // 途中の案件を、一覧のボタン1つで見送りにしてはいけない。
  // 提案一覧でも同じ理由で動かさないようにしている（packages/domain の
  // stanceForProposalStatus）。一覧の上の「参加中の案件」と下の一覧に同じ案件が
  // 並ぶので、ここを開けておくと下から落とせてしまう。
  if (stance === "参加") {
    return (
      <>
        <StancePill stance={stance} />
        <span className="text-xs text-slate-500">判断の変更は案件ページから</span>
      </>
    );
  }

  return (
    <>
      {CHOICES.map(({ stance: value, label, title }) => {
        const active = stance === value;
        return (
          <button
            key={value}
            type="button"
            // 同じものを押し直したら「未定」に戻す。押し間違いを一覧のまま取り消せる
            onClick={() => choose(active ? "未定" : value)}
            disabled={pending}
            title={title}
            aria-pressed={active}
            className={`${BUTTON} ${
              active
                ? "border-amber-400 bg-amber-50 font-medium text-amber-900"
                : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
            }`}
          >
            {active ? `${label}（取り消す）` : label}
          </button>
        );
      })}
      {/* 保留は一覧から押せないので、いまの状態だけ見せる */}
      {stance === "保留" && <StancePill stance={stance} />}
      {error !== null && (
        <span role="alert" className="text-xs text-rose-700">
          {error}
        </span>
      )}
    </>
  );
}
