"use client";

// 画面の上に重ねて出す小窓。協力会社の追加・編集で使う。
//
// 開いているかどうかはURL（?partner=...）で決まる。閉じる操作は closeHref への遷移に
// 統一しているので、ブラウザの戻るでも同じ状態に戻る。
//
// 閉じ方は3つ用意する（どれか1つだと詰まる人が出る）。
//   × ボタン ／ 背景のクリック ／ Escキー
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { X } from "lucide-react";
import type { ReactNode } from "react";

export function Modal({ title, closeHref, children }: { title: string; closeHref: string; children: ReactNode }) {
  const router = useRouter();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") router.push(closeHref);
    };
    document.addEventListener("keydown", onKeyDown);

    // 小窓の裏の一覧がスクロールしてしまうと、どこを触っているか分からなくなる
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [router, closeHref]);

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-3 sm:p-6"
      // 背景を押したときだけ閉じる。小窓の中で押して外で離した場合に閉じないよう、
      // clickではなくmouseDownの対象で判定する
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) router.push(closeHref);
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        className="w-full max-w-2xl rounded-md border border-slate-200 bg-white shadow-lg"
      >
        <header className="flex items-center justify-between gap-2 border-b border-slate-200 px-3 py-2">
          <h2 id="modal-title" className="text-xs font-semibold tracking-wide text-slate-700">
            {title}
          </h2>
          <Link
            href={closeHref}
            aria-label="閉じる"
            className="rounded border border-slate-200 p-1 text-slate-500 hover:bg-slate-50"
          >
            <X size={14} />
          </Link>
        </header>
        <div className="p-3">{children}</div>
      </div>
    </div>
  );
}
