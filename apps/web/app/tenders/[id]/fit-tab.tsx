// 参加判断。docs/ai-nyusatsu-bu-prototype-v7.jsx の FitTab 相当。
//
// プロトタイプに無い「過去の落札額」を足している。国の入札は予定価格を原則として
// 事前公表しないため、予定価格だけでは規模感が分からず参加を判断できないため
// （ユーザー判断 2026-08-22）。予定価格ではなく実績であることは画面で断る。
import type { AwardScale } from "@ai-nyusatsu-bu/domain";
import { Panel, Pill, ReasonIcon, Verdict, verdictBarTone, Bar } from "@/components/ui";

/** 金額は円単位のinteger（CLAUDE.md）。3桁区切りでそのまま出す。 */
function yen(value: number): string {
  return `${value.toLocaleString("ja-JP")}円`;
}

function AwardScalePanel({ scale }: { scale: AwardScale | null }) {
  if (scale === null) {
    return (
      <Panel title="過去の落札額">
        <p className="text-xs leading-relaxed text-slate-600">
          目安にできる過去の落札実績がありません。件数が少なすぎる場合は、外れ値を相場と
          見せないために表示していません。
        </p>
      </Panel>
    );
  }
  return (
    <Panel title="過去の落札額">
      <div className="flex items-baseline gap-1">
        <span className="text-2xl font-semibold tabular-nums">{yen(scale.median)}</span>
        <span className="text-xs text-slate-500">中央値</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        <Pill>{scale.scope}</Pill>
        <Pill>{scale.n}件</Pill>
        <Pill>直近24か月</Pill>
      </div>
      <dl className="mt-3 space-y-1 text-xs text-slate-700">
        <div className="flex justify-between gap-2">
          <dt className="text-slate-500">よくある範囲（25%〜75%）</dt>
          <dd className="tabular-nums">
            {yen(scale.p25)} 〜 {yen(scale.p75)}
          </dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-slate-500">最小〜最大</dt>
          <dd className="tabular-nums">
            {yen(scale.min)} 〜 {yen(scale.max)}
          </dd>
        </div>
      </dl>
      <p className="mt-3 text-xs leading-relaxed text-slate-500">
        落札実績オープンデータに基づく<span className="font-semibold">過去の落札額</span>です。
        この案件の予定価格ではありません。国の入札では予定価格を事前公表しないことが多いため、
        規模感の目安として出しています。
      </p>
    </Panel>
  );
}

export type FitTabProposal = {
  score: number;
  reasons_ok: string[];
  reasons_ng: string[];
  excluded_reason: string | null;
};

export function FitTab({
  proposal,
  awardScale,
}: {
  proposal: FitTabProposal | null;
  awardScale: AwardScale | null;
}) {
  if (!proposal) {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        <Panel title="参加判断">
          <p className="text-xs text-slate-600">まだ条件セットとの照合が行われていません。</p>
        </Panel>
        <AwardScalePanel scale={awardScale} />
      </div>
    );
  }
  const eligible = proposal.excluded_reason === null;
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Panel title="適合率">
        <div className="flex items-baseline gap-1">
          <span className="text-3xl font-semibold tabular-nums">{proposal.score}</span>
          <span className="text-xs text-slate-500">/ 100</span>
        </div>
        <div className="mt-2">
          <Bar value={proposal.score} tone={verdictBarTone(eligible, proposal.score)} />
        </div>
        <div className="mt-2">
          <Verdict eligible={eligible} score={proposal.score} />
        </div>
        <p className="mt-3 text-xs leading-relaxed text-slate-500">
          配点：資格区分20／営業品目20／等級15／競争参加地域15／予定価格10／残日数10／協力会社10
        </p>
      </Panel>
      <Panel title="参加できる理由">
        {proposal.reasons_ok.length === 0 ? (
          <p className="text-xs text-slate-400">なし</p>
        ) : (
          <ul className="space-y-1.5">
            {proposal.reasons_ok.map((r) => (
              <li key={r} className="flex gap-1.5 text-xs text-slate-700">
                <ReasonIcon kind="ok" />
                {r}
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel title="確認が必要な点">
        {proposal.reasons_ng.length === 0 ? (
          <p className="text-xs text-slate-400">なし</p>
        ) : (
          <ul className="space-y-1.5">
            {proposal.reasons_ng.map((r) => (
              <li key={r} className="flex gap-1.5 text-xs text-slate-700">
                <ReasonIcon kind="ng" />
                {r}
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <div className="sm:col-span-3">
        <AwardScalePanel scale={awardScale} />
      </div>
    </div>
  );
}
