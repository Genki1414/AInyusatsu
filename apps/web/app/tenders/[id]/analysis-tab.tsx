// 公告の中身。docs/ai-nyusatsu-bu-prototype-v7.jsx の AnalysisTab 相当。
//
// 抽出結果には必ず原文の引用と出典を持たせ、出典のない抽出はUIで「未確認」として扱う
// （CLAUDE.md 最重要の前提3）。プロトタイプのモックデータには引用・出典が無いため、
// この点は実データにあわせてプロトタイプから拡張している。
//
// 営業品目・等級・競争参加地域・履行場所は tenders 側（コネクタの確定値優先でAI解析が
// 空欄だけ埋めたもの）を表示に使うが、その値がAI解析（プロンプト1）の抽出結果と一致する
// ときだけ根拠（引用・出典）を添える。コネクタ由来の値にAIの根拠を誤って紐付けないため
// （値が食い違う＝コネクタの確定値が採用されたケースでは根拠を出さない）。
import { AlertTriangle } from "lucide-react";
import { Bar, Field, Panel, Pill } from "@/components/ui";

export type AnalysisTabTender = {
  item: string | null;
  grade: string | null;
  areas: string[];
  place: string | null;
};

type EvidencedValue<T> = { value: T; quote: string | null; source: string | null };

type RawBasicInfo = {
  item?: EvidencedValue<string | null>;
  grade?: EvidencedValue<string | null>;
  areas?: EvidencedValue<string[]>;
  place?: EvidencedValue<string | null>;
  unknown_fields?: string[];
};

export type AnalysisTabAnalysis = {
  qualifications: { text: string; category: string; quote: string; source: string }[];
  conditions: { text: string; quote: string; source: string }[];
  notes: { text: string; importance: "critical" | "normal"; reason: string; quote: string; source: string }[];
  trades: { trade: string; confidence: number; evidence: string; source: string; excluded: boolean; excluded_reason: string | null }[];
  raw: { basicInfo?: RawBasicInfo; qualifications?: { unknown_reason: string | null } } | null;
} | null;

// AI解析プロンプト集.md §1 の出力キー→画面表示名。unknown_fields（AIが判定できなかった
// 項目）をユーザーに分かる形で示すために使う。
const FIELD_LABELS: Record<string, string> = {
  name: "案件名",
  agency: "発注機関",
  org_unit: "部署",
  notice_no: "公告番号",
  notice_date: "公告日",
  submit_deadline: "提出期限",
  qa_deadline: "質問期限",
  bid_open_at: "開札日時",
  term_from: "履行期間（開始）",
  term_to: "履行期間（終了）",
  place: "履行場所",
  qual_category: "資格区分",
  item: "営業品目",
  grade: "等級",
  areas: "競争参加地域",
  budget: "予定価格",
  jv_allowed: "JVの可否",
  electronic_bidding: "電子入札対応",
};

function sameStrings(a: string[], b: string[]) {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}

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

  const basicInfo = analysis.raw?.basicInfo;
  // コネクタの確定値が採用された（AIの抽出値と食い違う）場合は根拠を出さない。
  const itemEvidence = basicInfo?.item && basicInfo.item.value === tender.item ? basicInfo.item : null;
  const gradeEvidence = basicInfo?.grade && basicInfo.grade.value === tender.grade ? basicInfo.grade : null;
  const areasEvidence = basicInfo?.areas && sameStrings(basicInfo.areas.value, tender.areas) ? basicInfo.areas : null;
  const placeEvidence = basicInfo?.place && basicInfo.place.value === tender.place ? basicInfo.place : null;
  const unknownFieldLabels = (basicInfo?.unknown_fields ?? []).map((k) => FIELD_LABELS[k] ?? k);
  const qualUnknownReason = analysis.raw?.qualifications?.unknown_reason ?? null;
  const qualUnknownLabel = qualUnknownReason ? `未確認（${qualUnknownReason}）` : "未確認";

  return (
    <div className="grid gap-3 lg:grid-cols-[2fr_1fr]">
      <div className="space-y-3">
        <Panel title="AIによる要約">
          <dl>
            <Field label="参加資格">
              {analysis.qualifications.length === 0 ? (
                <span className="text-slate-400">{qualUnknownLabel}</span>
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
              <div>
                {tender.item ?? "未確認"}／{tender.grade ?? "未確認"}
              </div>
              {itemEvidence && (
                <div className="mt-0.5 text-[11px]">
                  営業品目：<Evidence quote={itemEvidence.quote} source={itemEvidence.source} />
                </div>
              )}
              {gradeEvidence && (
                <div className="mt-0.5 text-[11px]">
                  等級：<Evidence quote={gradeEvidence.quote} source={gradeEvidence.source} />
                </div>
              )}
            </Field>
            <Field label="競争参加地域">
              <div>{tender.areas.length > 0 ? tender.areas.join("・") : "未確認"}</div>
              {areasEvidence && (
                <div className="mt-0.5 text-[11px]">
                  <Evidence quote={areasEvidence.quote} source={areasEvidence.source} />
                </div>
              )}
            </Field>
            <Field label="履行場所">
              <div>{tender.place ?? "未確認"}</div>
              {placeEvidence && (
                <div className="mt-0.5 text-[11px]">
                  <Evidence quote={placeEvidence.quote} source={placeEvidence.source} />
                </div>
              )}
            </Field>
            <Field label="参加条件">
              {analysis.conditions.length === 0 ? (
                <span className="text-slate-400">{qualUnknownLabel}</span>
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
          {unknownFieldLabels.length > 0 && (
            <p className="mt-2 text-xs text-slate-400">AIが資料から判定できなかった項目：{unknownFieldLabels.join("・")}</p>
          )}
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
