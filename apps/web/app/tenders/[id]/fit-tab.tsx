// 参加判断。docs/ai-nyusatsu-bu-prototype-v7.jsx の FitTab 相当。
//
// プロトタイプに無い「過去の落札実績」を足している。国の入札は予定価格を原則として
// 事前公表しないため、予定価格だけでは規模感が分からず参加を判断できないため
// （ユーザー判断 2026-08-22）。予定価格ではなく実績であることは画面で断る。
import type { MatchedAward } from "@ai-nyusatsu-bu/domain";
import { Panel, Pill, ReasonIcon, Verdict, verdictBarTone, Bar } from "@/components/ui";

/** 金額は円単位のinteger（CLAUDE.md）。3桁区切りでそのまま出す。 */
function yen(value: number): string {
  return `${value.toLocaleString("ja-JP")}円`;
}

/** 落札日は date 型。表示は Asia/Tokyo（CLAUDE.md）。 */
function openedOn(iso: string | null): string {
  if (!iso) return "落札日不明";
  const d = new Date(`${iso}T00:00:00+09:00`);
  return Number.isNaN(d.getTime()) ? "落札日不明" : d.toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" });
}

/** 一覧に出す件数。多すぎると読めないので、確からしい順に絞る。 */
const SHOWN = 5;

/** 照合の確からしさを色で示す。「類似」は参考程度なので目立たせない。 */
const MATCH_TONE = { 完全一致: "green", 部分一致: "amber", 類似: "slate" } as const;

function PastAwardsPanel({ awards }: { awards: MatchedAward[] }) {
  if (awards.length === 0) {
    return (
      <Panel title="過去の落札実績">
        <p className="text-xs leading-relaxed text-slate-600">
          名称の近い過去の落札が見つかりませんでした。新規の案件か、名称の付け方が大きく違う可能性があります。
        </p>
        <p className="mt-2 text-xs leading-relaxed text-slate-500">
          落札実績オープンデータには予定価格・品目分類・調達機関名称の列が無いため、
          品目や発注機関からの相場の割り出しはできません。案件名での照合のみ行っています。
        </p>
      </Panel>
    );
  }

  const exact = awards.filter((a) => a.match === "完全一致");
  const latest = awards[0];

  return (
    <Panel title={`過去の落札実績（${awards.length}件）`}>
      <div className="flex items-baseline gap-1">
        <span className="text-2xl font-semibold tabular-nums">{yen(latest.amount)}</span>
        <span className="text-xs text-slate-500">直近の落札額</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        <Pill tone={MATCH_TONE[latest.match]}>名称が{latest.match}</Pill>
        <Pill>{openedOn(latest.openedAt)}</Pill>
        {exact.length > 1 && <Pill>同名の落札{exact.length}件</Pill>}
      </div>

      <ul className="mt-3 space-y-1.5">
        {awards.slice(0, SHOWN).map((a, i) => (
          <li key={`${a.openedAt}-${a.name}-${i}`} className="border-t border-slate-100 pt-1.5 first:border-0 first:pt-0">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-xs text-slate-500">{openedOn(a.openedAt)}</span>
              <span className="text-xs font-semibold tabular-nums">{yen(a.amount)}</span>
            </div>
            <div className="text-xs text-slate-700">
              <span className="mr-1 text-slate-400">[{a.match}]</span>
              {a.name}
            </div>
            {a.winnerName && <div className="text-xs text-slate-500">落札者：{a.winnerName}</div>}
          </li>
        ))}
      </ul>
      {awards.length > SHOWN && <p className="mt-2 text-xs text-slate-500">ほか{awards.length - SHOWN}件</p>}

      <p className="mt-3 text-xs leading-relaxed text-slate-500">
        落札実績オープンデータに基づく<span className="font-semibold">過去の落札額</span>です。
        この案件の予定価格ではありません。名称の近さだけで照合しているため、
        名称が似ていても規模や内容が違うことがあります。金額は必ず名称と併せて確認してください。
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
  pastAwards,
}: {
  proposal: FitTabProposal | null;
  pastAwards: MatchedAward[];
}) {
  if (!proposal) {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        <Panel title="参加判断">
          <p className="text-xs text-slate-600">まだ条件セットとの照合が行われていません。</p>
        </Panel>
        <PastAwardsPanel awards={pastAwards} />
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
        <PastAwardsPanel awards={pastAwards} />
      </div>
    </div>
  );
}
