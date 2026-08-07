// 公告の中身。docs/ai-nyusatsu-bu-prototype-v7.jsx の AnalysisTab 相当。
//
// 抽出結果には必ず原文の引用と出典を持たせ、出典のない抽出はUIで「未確認」として扱う
// （CLAUDE.md 最重要の前提3）。プロトタイプのモックデータには引用・出典が無いため、
// この点は実データにあわせてプロトタイプから拡張している。
import { AlertTriangle } from "lucide-react";
import { Bar, Field, Panel, Pill } from "@/components/ui";

export type AnalysisTabTender = {
  item: string | null;
  grade: string | null;
  areas: string[];
  place: string | null;
};

export type AnalysisTabAnalysis = {
  qualifications: { text: string; category: string; quote: string; source: string }[];
  conditions: { text: string; quote: string; source: string }[];
  notes: { text: string; importance: "critical" | "normal"; reason: string; quote: string; source: string }[];
  trades: { trade: string; confidence: number; evidence: string; source: string; excluded: boolean; excluded_reason: string | null }[];
} | null;

function Evidence({ quote, source }: { quote: string | null; source: string | null }) {
  if (!source) {
    return <span className="text-slate-400">（未確認：出典なし）</span>;
  }
  return (
    <span className="text-slate-400">
      「{quote}」（{source}）
    </span>
  );
}

export function AnalysisTab({ tender, analysis }: { tender: AnalysisTabTender; analysis: AnalysisTabAnalysis }) {
  if (!analysis) {
    return (
      <Panel title="公告の中身">
        <p className="py-4 text-center text-xs text-slate-600">まだ解析していません。</p>
      </Panel>
    );
  }
  return (
    <div className="grid gap-3 lg:grid-cols-[2fr_1fr]">
      <div className="space-y-3">
        <Panel title="AIによる要約">
          <dl>
            <Field label="参加資格">
              {analysis.qualifications.length === 0 ? (
                <span className="text-slate-400">未確認</span>
              ) : (
                <ul className="space-y-1">
                  {analysis.qualifications.map((q, i) => (
                    <li key={i}>
                      ・{q.text} <Evidence quote={q.quote} source={q.source} />
                    </li>
                  ))}
                </ul>
              )}
            </Field>
            <Field label="営業品目・等級">
              {tender.item ?? "未確認"}／{tender.grade ?? "未確認"}
            </Field>
            <Field label="競争参加地域">{tender.areas.length > 0 ? tender.areas.join("・") : "未確認"}</Field>
            <Field label="履行場所">{tender.place ?? "未確認"}</Field>
            <Field label="参加条件">
              {analysis.conditions.length === 0 ? (
                <span className="text-slate-400">未確認</span>
              ) : (
                <ul className="space-y-1">
                  {analysis.conditions.map((c, i) => (
                    <li key={i}>
                      ・{c.text} <Evidence quote={c.quote} source={c.source} />
                    </li>
                  ))}
                </ul>
              )}
            </Field>
          </dl>
        </Panel>

        {analysis.notes.length > 0 && (
          <Panel title="見落としやすい注意点">
            <ul className="space-y-1.5">
              {analysis.notes.map((n, i) => (
                <li key={i} className="flex gap-2 text-xs text-slate-700">
                  <AlertTriangle size={13} className="mt-0.5 shrink-0 text-amber-600" />
                  <span>
                    {n.importance === "critical" && <Pill tone="rose">重要</Pill>} {n.text}
                    <br />
                    <Evidence quote={n.quote} source={n.source} />
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </div>

      <div className="space-y-3">
        <Panel title="必要な協力業種">
          {analysis.trades.length === 0 ? (
            <p className="text-xs text-slate-500">対象なし</p>
          ) : (
            <ul className="space-y-2">
              {analysis.trades.map((x) => (
                <li key={x.trade}>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-semibold ${x.excluded ? "text-slate-400 line-through" : ""}`}>{x.trade}</span>
                    <span className="ml-auto text-xs tabular-nums text-slate-400">確度 {Math.round(x.confidence * 100)}%</span>
                  </div>
                  <div className="mt-1">
                    <Bar value={x.confidence * 100} tone={x.excluded ? "bg-slate-300" : "bg-blue-700"} />
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-slate-500">
                    根拠：{x.evidence}（{x.source}）
                  </p>
                  {x.excluded && x.excluded_reason && <p className="mt-0.5 text-xs text-slate-400">除外理由：{x.excluded_reason}</p>}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
