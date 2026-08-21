// 資料。docs/ai-nyusatsu-bu-prototype-v7.jsx の DocsTab 相当。
//
// 資料原本（storage_key）はユーザーに配らない方針（CLAUDE.md 最重要の前提4）のため、
// ダウンロード・プレビューは提供しない。取得状況と公告元URLのみ表示する。
//
// 「機関が出していない（正常）」と「取得失敗（要対応）」は文言を分ける
// （CLAUDE.md 最重要の前提7 / docs/資料取得方針_v3.md「資料が無い理由を2つに分ける」）。
// 「ありません」と「取れていません」は意味が違う。判定は packages/domain の
// document_status.ts に置き、この画面は表示だけを行う。
//
// 御社による正式取得（タスク4-1追加）：本部の取得（AI解析用）とは別に、顧客自身が
// 自社名義で資料を取得する必要がある（docs/資料取得方針_v3.md §1・§5）。取得方法は
// tenders.acquire_method に応じて案内する。電子調達の手順は同資料 §0-1
// （2026-08-01 実機確認）に基づき、ICカードが不要な経路を案内する
// （プロトタイプのOfficialModal執筆時点はICカードが必要という古い前提だったため、
// 実機確認済みの内容に合わせて書き換えている）。
import { REQUIRED_DOC_KINDS, type DocumentAvailability, type DocumentAvailabilityStatus } from "@ai-nyusatsu-bu/domain";
import { Panel, Pill } from "@/components/ui";
import { setOfficialStatus } from "./official-actions";

export type TenderDocumentRow = {
  kind: string;
  fetched: boolean;
  fetched_at: string | null;
  page_count: number | null;
  ocr_used: boolean;
  extract_error: string | null;
};

// 状態ごとの表示。「未公開」は正常な状態なので警告色にしない。
const STATUS_VIEW: Record<DocumentAvailabilityStatus, { label: string; tone: "green" | "amber" | "rose" | "slate"; note: (kind: string) => string }> = {
  取得済: { label: "取得済", tone: "green", note: () => "" },
  本文なし: { label: "本文なし", tone: "amber", note: (kind) => `${kind}は取得できましたが、本文を読み取れていません` },
  未公開: { label: "この案件にはありません", tone: "slate", note: (kind) => `この案件には${kind}がありません` },
  取得失敗: { label: "取得できていません", tone: "rose", note: (kind) => `${kind}を取得できていません` },
  未確認: { label: "未確認", tone: "slate", note: (kind) => `${kind}はまだ確認できていません` },
};

export type TenderLotRow = {
  line_no: number;
  item: string;
  spec: string | null;
  qty: number | string | null;
  unit: string | null;
  trade: string | null;
};

type OfficialStepGroup = { label: string | null; steps: string[] };

// 電子調達は2通りの経路がある。方法Aは実機確認済み（docs/資料取得方針_v3.md §0-1、
// 2026-08-01）、方法B（電子認証カードでのログイン）はユーザーからの要望で追加した。
// どちらも最終的に同じ資料一式が取得できる。
const OFFICIAL_STEP_GROUPS: Record<string, OfficialStepGroup[]> = {
  電子調達: [
    {
      label: "方法A：連絡先情報を入力する（ICカード不要）",
      steps: [
        "調達ポータルの案件検索から、この案件の公告番号で検索する",
        "案件詳細の「調達資料 ダウンロードURL」を開く",
        "連絡先情報の入力方法で「連絡先情報をはじめから入力する」を選ぶ",
        "商号・氏名・電話・メールを入力し、資料一式をダウンロードする",
      ],
    },
    {
      label: "方法B：電子調達システムにログインする（電子認証カードが必要）",
      steps: [
        "ICカードリーダーに電子認証カードをセットする",
        "調達ポータルへ、電子調達システムに登録済みの連絡先情報でログインする",
        "この案件の公告番号で検索し、調達資料をダウンロードする",
      ],
    },
  ],
  公開Web: [
    {
      label: null,
      steps: ["公告記載の窓口へ交付申請する（不要な場合はそのまま参加可）", "様式一式をダウンロードする", "質問期限までに不明点を照会する"],
    },
  ],
  公開PDF: [{ label: null, steps: ["公告記載の取得方法を確認する", "調達ポータルから御社名義で取得する"] }],
  メール: [{ label: null, steps: ["交付メールに返信して参加表明する", "資料一式の再送を依頼する（御社名義の記録を残すため）"] }],
  FAX: [{ label: null, steps: ["FAX申込様式を印刷する", "発注機関へ送信する", "受領した資料を確認する"] }],
};

const OFFICIAL_STATUS_TONE = { 未取得: "rose", 申請中: "amber", 取得済: "green" } as const;

const GEPS_PORTAL_TOP_URL = "https://www.p-portal.go.jp/";

export function DocsTab({
  availabilities,
  documents,
  documentsFailureReason,
  lots,
  sourceUrl,
  connectorId,
  tenderId,
  acquireMethod,
  officialStatus,
}: {
  availabilities: DocumentAvailability[];
  documents: TenderDocumentRow[];
  documentsFailureReason: string | null;
  lots: TenderLotRow[];
  sourceUrl: string | null;
  connectorId: string | null;
  tenderId: string;
  acquireMethod: string;
  officialStatus: "未取得" | "申請中" | "取得済";
}) {
  const fetched = availabilities.filter((a) => a.status === "取得済");
  const notPublished = availabilities.filter((a) => a.status === "未公開");
  const needsAction = availabilities.filter((a) => a.needsAction);
  const unchecked = availabilities.filter((a) => a.status === "未確認");
  const stepGroups = OFFICIAL_STEP_GROUPS[acquireMethod] ?? [{ label: null, steps: ["公告記載の手順を確認する"] }];

  return (
    <div className="space-y-3">
      <Panel title="本部による取得">
        <div className="flex flex-wrap items-center gap-2">
          {needsAction.length > 0 ? (
            <Pill tone="rose">取得できていない資料が{needsAction.length}件</Pill>
          ) : unchecked.length > 0 ? (
            <Pill tone="slate">資料をまだ確認できていません</Pill>
          ) : (
            <Pill tone="green">取得できるものは揃っています</Pill>
          )}
        </div>
        <p className="mt-1.5 text-xs leading-relaxed text-slate-600">
          取得済 {fetched.length}/{REQUIRED_DOC_KINDS.length}件
          {notPublished.length > 0 && (
            <>
              {" "}
              <span className="text-slate-500">
                （{notPublished.map((a) => a.kind).join("・")}は、この案件にはありません）
              </span>
            </>
          )}
        </p>
        {needsAction.length > 0 && (
          <ul className="mt-1.5 space-y-0.5">
            {needsAction.map((a) => (
              <li key={a.kind} className="text-xs text-rose-700">
                ・{STATUS_VIEW[a.status].note(a.kind)}
              </li>
            ))}
          </ul>
        )}
        {documentsFailureReason && (
          <p className="mt-1.5 break-all text-xs text-rose-700">取得時のエラー：{documentsFailureReason}</p>
        )}
        <p className="mt-1 text-xs text-slate-400">
          AI解析のための取得です。取得できた資料の原本はお渡ししていません。
        </p>
      </Panel>

      <Panel title="御社による正式取得">
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone={OFFICIAL_STATUS_TONE[officialStatus]}>{officialStatus}</Pill>
          <span className="text-xs text-slate-500">取得方法：{acquireMethod}</span>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-amber-900">
          システムが取得した資料は解析用です。この案件は御社名義での正式取得が必要です。
        </p>
        <div className="mt-2 space-y-3">
          {stepGroups.map((group, gi) => (
            <div key={group.label ?? gi}>
              {group.label && <div className="text-xs font-semibold text-slate-700">{group.label}</div>}
              <ol className="mt-1 space-y-1.5">
                {group.steps.map((s, i) => (
                  <li key={s} className="flex gap-2 text-xs text-slate-700">
                    <span className="w-4 shrink-0 tabular-nums text-slate-400">{i + 1}</span>
                    {s}
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
        {connectorId === "geps" ? (
          <p className="mt-2 text-xs text-slate-500">
            公告元URLは調達ポータル（電子調達システム）の画面遷移によるものです。案件ごとに固定されないため、リンク先が表示されない場合があります。上記の手順のとおり、
            <a href={GEPS_PORTAL_TOP_URL} target="_blank" rel="noopener noreferrer" className="text-blue-800 underline">
              調達ポータル
            </a>
            で公告番号から案件を検索してください。
          </p>
        ) : (
          sourceUrl && (
            <p className="mt-2 text-xs text-slate-500">
              公告元URL：
              <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="break-all text-blue-800 underline">
                {sourceUrl}
              </a>
            </p>
          )
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <form action={setOfficialStatus.bind(null, tenderId, "申請中")}>
            <button
              type="submit"
              disabled={officialStatus === "申請中"}
              className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            >
              申請中にする
            </button>
          </form>
          <form action={setOfficialStatus.bind(null, tenderId, "取得済")}>
            <button
              type="submit"
              disabled={officialStatus === "取得済"}
              className="rounded border border-blue-800 bg-blue-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-900 disabled:opacity-40"
            >
              取得済にする
            </button>
          </form>
        </div>
      </Panel>

      <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
        <p className="text-xs text-amber-900">
          本部が取得した資料は、AIが解析するためのものです。入札に参加するには、入札説明書等を
          <span className="font-semibold">御社の名義で</span>取得する必要があります。
        </p>
      </div>

      <Panel title="取得状況" dense>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-500">
              <tr className="text-left">
                <th className="px-3 py-2 font-medium">種別</th>
                <th className="px-2 py-2 font-medium">取得</th>
                <th className="px-2 py-2 font-medium">取得日時</th>
                <th className="px-2 py-2 font-medium">ページ数</th>
                <th className="px-2 py-2 font-medium">OCR</th>
              </tr>
            </thead>
            <tbody>
              {availabilities.map((a) => {
                const doc = documents.find((d) => d.kind === a.kind && d.fetched);
                const view = STATUS_VIEW[a.status];
                return (
                  <tr key={a.kind} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-medium">{a.kind}</td>
                    <td className="px-2 py-2">
                      <Pill tone={view.tone}>{view.label}</Pill>
                    </td>
                    <td className="px-2 py-2 tabular-nums text-slate-600">
                      {doc?.fetched_at ? new Date(doc.fetched_at).toLocaleString("ja-JP") : "—"}
                    </td>
                    <td className="px-2 py-2 tabular-nums text-slate-600">{doc?.page_count ?? "—"}</td>
                    <td className="px-2 py-2 text-slate-600">{doc ? (doc.ocr_used ? "使用" : "未使用") : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      {lots.length > 0 && (
        <Panel title="数量表（業種を自動で割当）" dense>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-500">
                <tr className="text-left">
                  <th className="px-3 py-2 font-medium">No</th>
                  <th className="px-2 py-2 font-medium">項目</th>
                  <th className="px-2 py-2 font-medium">仕様</th>
                  <th className="px-2 py-2 text-right font-medium">数量</th>
                  <th className="px-2 py-2 font-medium">割当業種</th>
                </tr>
              </thead>
              <tbody>
                {lots.map((l) => (
                  <tr key={l.line_no} className="border-t border-slate-100">
                    <td className="px-3 py-2 tabular-nums text-slate-400">{l.line_no}</td>
                    <td className="px-2 py-2 font-medium">{l.item}</td>
                    <td className="px-2 py-2 text-slate-600">{l.spec ?? "—"}</td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {l.qty ?? "—"} {l.unit ?? ""}
                    </td>
                    <td className="px-2 py-2">{l.trade ? <Pill tone="blue">{l.trade}</Pill> : <span className="text-slate-300">未判定</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  );
}
