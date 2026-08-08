// 提案条件。docs/ai-nyusatsu-bu-prototype-v7.jsx の ConditionsView 相当。
//
// 「原価に上乗せする率」（一般管理費・目標利益）はプロトタイプに含まれるが、対応する列が
// company_profiles / criteria_sets のどちらにも無い（原価集計はタスク4-5で未着手）ため、
// このタスク（3-4）では扱わない。
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { Panel } from "@/components/ui";
import { AREA_OPTIONS, ITEM_OPTIONS } from "@/lib/catalog";
import { requireOrgContext } from "@/lib/auth";
import { CriteriaForm, type CriteriaFormValues } from "./criteria-form";

type CriteriaSetRow = {
  id: string;
  name: string;
  items: string[];
  areas: string[];
  keywords: string[];
  ng_words: string[];
  min_budget: number | null;
  max_budget: number | null;
  min_days: number;
  active: boolean;
};

const BLANK: CriteriaFormValues = {
  id: null,
  name: "",
  items: [],
  areas: [],
  keywords: [],
  ng_words: [],
  min_budget: null,
  max_budget: null,
  min_days: 5,
  active: true,
};

export default async function CriteriaPage({ searchParams }: { searchParams: Promise<{ set?: string }> }) {
  const { set } = await searchParams;
  const { supabase, orgId, orgName } = await requireOrgContext();

  const [{ data: sets }, { data: profile }] = await Promise.all([
    supabase
      .from("criteria_sets")
      .select("id, name, items, areas, keywords, ng_words, min_budget, max_budget, min_days, active")
      .order("name")
      .returns<CriteriaSetRow[]>(),
    supabase.from("company_profiles").select("items, areas").eq("org_id", orgId).maybeSingle<{ items: string[]; areas: string[] }>(),
  ]);

  const itemOptions = profile?.items?.length ? profile.items : ITEM_OPTIONS;
  const areaOptions = profile?.areas?.length ? profile.areas : AREA_OPTIONS;

  const selected = (sets ?? []).find((s) => s.id === set) ?? null;
  const values: CriteriaFormValues = selected
    ? {
        id: selected.id,
        name: selected.name,
        items: selected.items ?? [],
        areas: selected.areas ?? [],
        keywords: selected.keywords ?? [],
        ng_words: selected.ng_words ?? [],
        min_budget: selected.min_budget,
        max_budget: selected.max_budget,
        min_days: selected.min_days,
        active: selected.active,
      }
    : BLANK;

  return (
    <AppShell active="criteria" orgName={orgName}>
      <Panel title="条件セット" right={<Link href="/criteria" className="text-xs text-blue-800 underline">セットを追加</Link>}>
        {(sets ?? []).length === 0 ? (
          <p className="text-xs text-slate-500">まだ条件セットがありません。下のフォームから作成してください。</p>
        ) : (
          <div className="flex flex-wrap gap-1">
            {(sets ?? []).map((s) => (
              <Link
                key={s.id}
                href={`/criteria?set=${s.id}`}
                className={`rounded px-2 py-1 text-xs ${
                  s.id === selected?.id
                    ? "bg-slate-800 text-white"
                    : `border ${s.active ? "border-slate-200 text-slate-600" : "border-slate-100 text-slate-400"}`
                }`}
              >
                {s.name}
                {!s.active && "（停止中）"}
              </Link>
            ))}
          </div>
        )}
        <p className="mt-2 text-xs text-slate-500">条件セットごとに案件マスタと照合し、適合した案件だけを提案します。</p>
      </Panel>

      <CriteriaForm key={values.id ?? "new"} values={values} itemOptions={itemOptions} areaOptions={areaOptions} />
    </AppShell>
  );
}
