// 画面共通のUI部品。docs/ai-nyusatsu-bu-prototype-v7.jsx の Panel/Pill/Bar/Field/Btn/
// 各種ステータスPill・Verdict を、実データのステータス文字列（tenders.collect_status /
// proposals.status）にあわせて移植したもの。文言はプロトタイプのまま変えない。
import { AlertTriangle, CheckCircle2, X } from "lucide-react";
import type { ReactNode } from "react";
import { AREA_OPTIONS } from "@/lib/catalog";

export function Panel({
  title,
  right,
  children,
  dense,
}: {
  title?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  dense?: boolean;
}) {
  return (
    <section className="overflow-hidden rounded-md border border-slate-200 bg-white">
      {title && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-3 py-2">
          <h2 className="text-xs font-semibold tracking-wide text-slate-700">{title}</h2>
          {right}
        </header>
      )}
      <div className={dense ? "" : "p-3"}>{children}</div>
    </section>
  );
}

const PILL_TONES = {
  slate: "bg-slate-100 text-slate-700 border-slate-200",
  blue: "bg-blue-50 text-blue-800 border-blue-200",
  green: "bg-emerald-50 text-emerald-800 border-emerald-200",
  amber: "bg-amber-50 text-amber-800 border-amber-200",
  rose: "bg-rose-50 text-rose-800 border-rose-200",
  violet: "bg-violet-50 text-violet-800 border-violet-200",
} as const;

export function Pill({ children, tone = "slate" }: { children: ReactNode; tone?: keyof typeof PILL_TONES }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs ${PILL_TONES[tone]}`}>
      {children}
    </span>
  );
}

export function Bar({ value, tone = "bg-blue-700" }: { value: number; tone?: string }) {
  return (
    <div className="h-1.5 overflow-hidden rounded bg-slate-100">
      <div className={`h-full ${tone}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

export function Field({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="grid grid-cols-3 gap-2 border-b border-slate-100 py-1.5 last:border-0">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="col-span-2 text-xs text-slate-800">{children}</dd>
    </div>
  );
}

const BTN_KINDS = {
  default: "bg-white border-slate-300 text-slate-700 hover:bg-slate-50",
  primary: "bg-blue-800 border-blue-800 text-white hover:bg-blue-900",
  ghost: "bg-transparent border-transparent text-slate-600 hover:bg-slate-100",
} as const;

export function btnClass(kind: keyof typeof BTN_KINDS = "default", size: "sm" | "md" = "md") {
  return `inline-flex items-center justify-center gap-1.5 rounded border font-medium disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-blue-300 ${BTN_KINDS[kind]} ${size === "sm" ? "px-2 py-1 text-xs" : "px-3 py-1.5 text-xs"}`;
}

// tenders.collect_status（未取得/取得中/取得済/AI解析中/解析完了/公開中/終了）
const COLLECT_STYLE: Record<string, string> = {
  未取得: "bg-slate-100 text-slate-600 border-slate-300",
  取得中: "bg-blue-50 text-blue-800 border-blue-200",
  取得済: "bg-blue-50 text-blue-800 border-blue-200",
  AI解析中: "bg-violet-50 text-violet-800 border-violet-200",
  解析完了: "bg-violet-50 text-violet-800 border-violet-200",
  公開中: "bg-emerald-50 text-emerald-800 border-emerald-300",
  終了: "bg-slate-50 text-slate-400 border-slate-200",
};
export function CollectPill({ s }: { s: string }) {
  return (
    <span className={`inline-block whitespace-nowrap rounded border px-1.5 py-0.5 text-xs ${COLLECT_STYLE[s] ?? PILL_TONES.slate}`}>
      {s}
    </span>
  );
}

// proposals.status（提案対象/配信済/既読/検討中/対象外）
const PROPOSE_STYLE: Record<string, string> = {
  提案対象: "bg-blue-50 text-blue-800 border-blue-200",
  配信済: "bg-emerald-50 text-emerald-800 border-emerald-300",
  既読: "bg-slate-100 text-slate-700 border-slate-300",
  検討中: "bg-amber-50 text-amber-800 border-amber-200",
  対象外: "bg-slate-50 text-slate-400 border-slate-200",
};
export function ProposePill({ s }: { s: string }) {
  return (
    <span className={`inline-block whitespace-nowrap rounded border px-1.5 py-0.5 text-xs ${PROPOSE_STYLE[s] ?? PILL_TONES.slate}`}>
      {s}
    </span>
  );
}

export function Verdict({ eligible, score }: { eligible: boolean; score: number }) {
  if (!eligible) {
    return (
      <Pill tone="rose">
        <X size={12} />
        参加できません
      </Pill>
    );
  }
  if (score >= 80) {
    return (
      <Pill tone="green">
        <CheckCircle2 size={12} />
        参加できます
      </Pill>
    );
  }
  return (
    <Pill tone="amber">
      <AlertTriangle size={12} />
      要確認
    </Pill>
  );
}

export function verdictBarTone(eligible: boolean, score: number) {
  if (!eligible) return "bg-rose-500";
  if (score < 80) return "bg-amber-500";
  return "bg-emerald-500";
}

export function ReasonIcon({ kind }: { kind: "ok" | "ng" }) {
  return kind === "ok" ? (
    <CheckCircle2 size={12} className="mt-0.5 shrink-0 text-emerald-600" />
  ) : (
    <AlertTriangle size={12} className="mt-0.5 shrink-0 text-amber-600" />
  );
}

// エリアのチェックボックス群。地方区分（AREA_OPTIONS）と都道府県を分けて表示する
// （optionsに両方混ざっていても、AREA_OPTIONSに含まれる値だけを地方区分として振り分ける）。
export function AreaCheckboxGroup({ name, options, selected }: { name: string; options: readonly string[]; selected: string[] }) {
  const unique = Array.from(new Set(options));
  const regionOptions: readonly string[] = AREA_OPTIONS;
  const regions = unique.filter((a) => regionOptions.includes(a));
  const prefectures = unique.filter((a) => !regionOptions.includes(a));
  const checkbox = "flex items-center gap-1.5 rounded border border-slate-200 px-2 py-1 text-xs text-slate-700";

  return (
    <div className="space-y-2">
      {regions.length > 0 && (
        <div>
          <div className="text-xs text-slate-500">地方区分</div>
          <div className="mt-1 flex flex-wrap gap-1">
            {regions.map((a) => (
              <label key={a} className={checkbox}>
                <input type="checkbox" name={name} value={a} defaultChecked={selected.includes(a)} />
                {a}
              </label>
            ))}
          </div>
        </div>
      )}
      {prefectures.length > 0 && (
        <div>
          <div className="text-xs text-slate-500">都道府県</div>
          <div className="mt-1 flex flex-wrap gap-1">
            {prefectures.map((a) => (
              <label key={a} className={checkbox}>
                <input type="checkbox" name={name} value={a} defaultChecked={selected.includes(a)} />
                {a}
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
