// 利用規約・プライバシーポリシーの共通枠。
//
// 【ログインしていなくても読めるようにする】
// 契約を検討している人が最初に読むものなので、requireOrgContext を通さない。
// AppShell（顧客向けの枠）も使わない。ログイン後のメニューが出ると、
// ログインしていない人には押せないリンクだらけになる。

import Link from "next/link";
import type { ReactNode } from "react";

export default function LegalLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-100">
      <header className="border-b border-slate-200 bg-slate-800 px-4 py-2.5">
        <Link href="/" className="text-sm font-semibold text-white">
          AI入札部
        </Link>
      </header>
      <main className="mx-auto max-w-3xl p-4">
        <article className="rounded-md border border-slate-200 bg-white p-5">{children}</article>
        <nav className="mt-3 flex flex-wrap gap-3 text-xs text-slate-500">
          <Link href="/terms" className="underline hover:text-slate-700">
            利用規約
          </Link>
          <Link href="/privacy" className="underline hover:text-slate-700">
            プライバシーポリシー
          </Link>
          <Link href="/login" className="underline hover:text-slate-700">
            ログイン
          </Link>
        </nav>
      </main>
    </div>
  );
}
