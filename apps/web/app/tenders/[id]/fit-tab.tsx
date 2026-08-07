// 参加判断。docs/ai-nyusatsu-bu-prototype-v7.jsx の FitTab 相当。
import { Panel, ReasonIcon, Verdict, verdictBarTone, Bar } from "@/components/ui";

export type FitTabProposal = {
  score: number;
  reasons_ok: string[];
  reasons_ng: string[];
  excluded_reason: string | null;
};

export function FitTab({ proposal }: { proposal: FitTabProposal | null }) {
  if (!proposal) {
    return (
      <Panel title="参加判断">
        <p className="text-xs text-slate-600">まだ条件セットとの照合が行われていません。</p>
      </Panel>
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
    </div>
  );
}
