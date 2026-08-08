"use client";

// 案件名・公告番号など、GEPS等の外部ポータルで検索するために手入力が必要な値を
// コピーできるようにするボタン（ユーザーからの要望：資料取得方針_v3.md の
// 「公告番号で検索する」手順を補助する）。
import { Check, Copy } from "lucide-react";
import { useState } from "react";

export function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      aria-label={`${label}をコピー`}
      className="inline-flex shrink-0 items-center gap-0.5 rounded border border-slate-200 px-1 py-0.5 text-[10px] text-slate-500 hover:bg-slate-50"
    >
      {copied ? <Check size={11} className="text-emerald-600" /> : <Copy size={11} />}
      {copied ? "コピー済" : "コピー"}
    </button>
  );
}
