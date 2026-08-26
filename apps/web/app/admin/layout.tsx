// 運営（本部）画面の枠。
//
// 顧客向けの画面は AppShell が背景色を敷いているが、運営画面はそれを使わない
// （ナビもログアウトも顧客向けのものなので出さない）。背景を敷かないと
// 白いパネルが白い背景に埋もれて、どこが入力欄か分からなくなる。
import type { ReactNode } from "react";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <div className="min-h-screen bg-slate-100 text-slate-800">{children}</div>;
}
