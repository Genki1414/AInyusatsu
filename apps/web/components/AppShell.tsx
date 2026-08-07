// 認証後の共通画面枠（ヘッダー・サイドナビ・フッター）。
// docs/ai-nyusatsu-bu-prototype-v7.jsx のヘッダー・ナビ・フッター文言をそのまま使う。
// ナビ項目は、この画面が実装されているものだけを載せる（未実装の項目へのリンクは作らない）。
import Link from "next/link";
import type { ReactNode } from "react";
import { logout } from "@/app/actions";

const NAV = [
  { key: "home", href: "/", label: "今日やること" },
  { key: "proposals", href: "/proposals", label: "提案された案件" },
  { key: "criteria", href: "/criteria", label: "提案条件" },
  { key: "qualifications", href: "/qualifications", label: "入札資格" },
] as const;

export type NavKey = (typeof NAV)[number]["key"];

export function AppShell({ active, orgName, children }: { active: NavKey; orgName: string; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-100 text-slate-800">
      <header className="sticky top-0 z-20 bg-slate-800 text-slate-100">
        <div className="mx-auto flex h-12 max-w-6xl items-center gap-3 px-3">
          <span className="grid h-6 w-6 place-items-center rounded bg-white text-xs font-bold text-slate-800">入</span>
          <span className="text-sm font-semibold tracking-wide">AI入札部</span>
          <span className="rounded border border-slate-600 px-1 text-xs text-slate-400">β</span>
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-xs text-slate-300 sm:inline">{orgName}</span>
            <form action={logout}>
              <button type="submit" className="rounded border border-slate-600 px-2 py-1 text-xs hover:bg-slate-700">
                ログアウト
              </button>
            </form>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-6xl flex-col gap-3 p-3 md:flex-row md:items-start">
        <nav className="md:w-52 md:shrink-0">
          <ul className="flex gap-1 overflow-x-auto pb-1 md:flex-col md:pb-0">
            {NAV.map((item) => (
              <li key={item.key} className="shrink-0 md:w-full">
                <Link
                  href={item.href}
                  className={`flex items-center gap-2 whitespace-nowrap rounded border px-3 py-2 text-xs ${
                    active === item.key
                      ? "border-slate-300 bg-white font-semibold text-slate-900"
                      : "border-transparent text-slate-600 hover:border-slate-200 hover:bg-white"
                  }`}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <main className="min-w-0 flex-1 space-y-3">{children}</main>
      </div>

      <div className="mx-auto max-w-6xl px-3 pb-6 pt-1">
        <p className="border-t border-slate-200 pt-3 text-xs leading-relaxed text-slate-400">
          本サービスは、中小企業庁が運営する
          <a
            href="https://www.kkj.go.jp/"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-slate-600"
          >
            官公需情報ポータルサイト
          </a>
          のAPI、および各発注機関が公開する情報を利用しています。掲載情報の正確性・網羅性は保証されません。
          入札への参加にあたっては、必ず発注機関が公表する原本をご確認ください。
        </p>
      </div>
    </div>
  );
}
