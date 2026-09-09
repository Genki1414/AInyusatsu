// 運営（本部）画面の枠。
//
// 顧客向けの画面は AppShell が背景色を敷いているが、運営画面はそれを使わない
// （ナビもログアウトも顧客向けのものなので出さない）。背景を敷かないと
// 白いパネルが白い背景に埋もれて、どこが入力欄か分からなくなる。
//
// 【顧客画面と見分けがつくようにする】（ユーザー要望 2026-09-09）
// 運営画面は**全社のデータが見える**。顧客画面と同じ見た目だと、
// どちらを開いているか分からないまま操作することになる。
// タブ（題名・アイコン）と画面上部の帯を、顧客画面とは別の色にする。
import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  // タブに出る題名。顧客画面は「AI入札部」なので、頭に「本部」を付けて区別する。
  // タブが細いと後ろが切れるため、**先頭に置く**
  title: "本部｜AI入札部",
};

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-100 text-slate-800">
      {/* 顧客画面のヘッダーは bg-slate-800（濃い灰）。ここは臙脂にして、
          スクリーンショットや画面共有でも取り違えないようにする */}
      <header className="bg-rose-900 text-rose-50">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-2 px-4 py-2">
          <span className="grid h-6 w-6 place-items-center rounded bg-white text-xs font-bold text-rose-900">
            本
          </span>
          <span className="text-sm font-semibold tracking-wide">AI入札部 本部</span>
          {/* 何ができる画面かを一言で。「見えてはいけないものが見えている」と
              気づける状態にしておく */}
          <span className="rounded border border-rose-700 px-1.5 py-0.5 text-xs text-rose-200">
            全社のデータが見えます
          </span>
        </div>
      </header>
      {children}
    </div>
  );
}
