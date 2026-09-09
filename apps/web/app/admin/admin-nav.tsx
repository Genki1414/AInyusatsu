"use client";

// 本部画面のタブ。
//
// 【なぜタブにするか】
// これまでは「運営／アカウント／営業AI連携」がただのリンク列で、
// 見出しの文字だけが自分の居場所を示していた。3画面を行き来すると、
// いまどこにいるのか分からなくなる（ユーザー要望 2026-09-09）。
//
// 【現在地はURLで決める】
// 各ページから「自分はこれ」と渡す形だと、渡し忘れたページだけ
// どのタブも光らなくなる。URLから決めれば、ページ側は何もしなくてよい。

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/admin", label: "運営" },
  { href: "/admin/accounts", label: "アカウント" },
  { href: "/admin/sales-ai", label: "営業AI連携" },
] as const;

/** そのタブが現在地か。/admin は他の画面の前方一致になるので完全一致で見る。 */
function isActive(pathname: string, href: string): boolean {
  return href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);
}

export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav className="border-b border-slate-200 bg-white">
      <ul className="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-4">
        {TABS.map((tab) => {
          const active = isActive(pathname, tab.href);
          return (
            <li key={tab.href} className="shrink-0">
              <Link
                href={tab.href}
                // 現在地は下線で示す。色だけで分けると、色覚や画面の設定で伝わらない
                aria-current={active ? "page" : undefined}
                className={`-mb-px flex border-b-2 px-3 py-2.5 text-xs whitespace-nowrap ${
                  active
                    ? "border-rose-800 font-semibold text-rose-900"
                    : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800"
                }`}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
