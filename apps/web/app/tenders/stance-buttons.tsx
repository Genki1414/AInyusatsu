"use client";

// 案件一覧から直接、判断（検討 / 見送り）を記録する。
//
// 【なぜ一覧に置くか】
// これまで判断は案件ページだけで押せた。1件ずつ開いて、下までスクロールして押して、
// 戻る。20件を振り分けると20往復になる。毎日使うのでここが一番の手数だった
// （ユーザー要望 2026-10-17「自社で使用するのに使い勝手をよくしたい」）。
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

import { useState, useTransition } from "react";
import { setStance } from "./[id]/stance-actions";
import { StancePill } from "@/components/ui";

/** 一覧から選べる判断。参加は案件ページで決める（上のコメント参照）。 */
const CHOICES = [
  { stance: "検討", label: "検討する", title: "残して、あとで参加するか決める" },
  { stance: "見送り", label: "見送る", title: "この案件は参加しない" },
] as const;

export function StanceButtons({ tenderId, stance: saved }: { tenderId: string; stance: string | undefined }) {
  const [stance, setStanceLocal] = useState<string | undefined>(saved);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // 【参加の案件はここから落とさない】
  // 参加にすると提出までの段取りが始まる。資料を取り、見積を集め、書類をそろえている
  // 途中の案件を、一覧のボタン1つで見送りにしてはいけない。
  // 提案一覧でも同じ理由で動かさないようにしている（packages/domain の
  // stanceForProposalStatus）。一覧の上の「参加中の案件」と下の一覧に同じ案件が
  // 並ぶので、ここを開けておくと下から落とせてしまう。
  if (stance === "参加") {
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <StancePill stance={stance} />
        <span className="text-xs text-slate-500">判断の変更は案件ページから</span>
      </div>
    );
  }

  function choose(next: string) {
    // 同じものを押し直したら「未定」に戻す。押し間違いを一覧のまま取り消せる
    const target = stance === next ? "未定" : next;
    const before = stance;
    setStanceLocal(target);
    setError(null);
    startTransition(async () => {
      const result = await setStance(tenderId, target);
      if (result.error !== null) {
        setStanceLocal(before);
        setError(result.error);
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {CHOICES.map(({ stance: value, label, title }) => {
        const active = stance === value;
        return (
          <button
            key={value}
            type="button"
            onClick={() => choose(value)}
            disabled={pending}
            title={title}
            aria-pressed={active}
            className={`rounded border px-2 py-1 text-xs disabled:opacity-40 ${
              active
                ? value === "検討"
                  ? "border-amber-400 bg-amber-50 font-medium text-amber-900"
                  : "border-rose-300 bg-rose-50 font-medium text-rose-900"
                : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
            }`}
          >
            {active ? `${label}（取り消す）` : label}
          </button>
        );
      })}
      {/* 参加・保留は一覧から押せないので、いまの状態だけ見せる */}
      {stance !== undefined && !CHOICES.some((c) => c.stance === stance) && <StancePill stance={stance} />}
      {error !== null && (
        <span role="alert" className="text-xs text-rose-700">
          {error}
        </span>
      )}
    </div>
  );
}
