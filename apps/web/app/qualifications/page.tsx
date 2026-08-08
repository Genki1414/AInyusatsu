// 入札資格。docs/ai-nyusatsu-bu-prototype-v7.jsx の QualView 相当。
// プロトタイプは読み取り専用の表示だが、実データはこの画面から入力する以外に方法が無いため
// 編集フォームにしている（ラベル・説明文はプロトタイプのまま使う）。
import { AppShell } from "@/components/AppShell";
import { Panel } from "@/components/ui";
import { requireOrgContext } from "@/lib/auth";
import { QualificationsForm, type QualificationsFormProfile } from "./qualifications-form";

const EMPTY_PROFILE: QualificationsFormProfile = { qual_categories: [], grades: {}, items: [], areas: [], qual_valid_to: null };

export default async function QualificationsPage() {
  const { supabase, orgId, orgName } = await requireOrgContext();

  const { data: profile } = await supabase
    .from("company_profiles")
    .select("qual_categories, grades, items, areas, qual_valid_to")
    .eq("org_id", orgId)
    .maybeSingle<QualificationsFormProfile>();

  return (
    <AppShell active="qualifications" orgName={orgName}>
      <Panel title="これから資格を取る方へ">
        <ol className="space-y-2">
          {[
            ["必要書類を集める", "登記事項証明書、納税証明書、財務諸表など。個人事業主の場合は別の書類になります。"],
            ["オンラインで申請する", "統一資格審査申請のサイトから申請します。紙での申請も可能です。"],
            ["審査を待つ", "審査には数週間かかります。決算内容などから等級（A〜D）が決まります。"],
            ["資格審査結果通知書を受け取る", "この通知書が入札参加の証明になります。入札のたびに写しを提出します。"],
            ["電子調達の準備をする", "電子入札にはICカードとカードリーダーが必要です。取得に2週間程度かかります。"],
          ].map(([title, desc], i) => (
            <li key={title} className="flex gap-2.5">
              <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-slate-800 text-xs tabular-nums text-white">
                {i + 1}
              </span>
              <div>
                <div className="text-xs font-semibold">{title}</div>
                <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{desc}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="mt-3 text-xs text-slate-400">※ 手続きの詳細と最新の様式は、必ず公式サイトでご確認ください。</p>
      </Panel>

      <QualificationsForm profile={profile ?? EMPTY_PROFILE} />
    </AppShell>
  );
}
