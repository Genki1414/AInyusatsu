// 資料。docs/ai-nyusatsu-bu-prototype-v7.jsx の DocsTab 相当。
//
// 資料原本（storage_key）はユーザーに配らない方針（CLAUDE.md 最重要の前提4）のため、
// ダウンロード・プレビューは提供しない。取得状況と公告元URLのみ表示する。
//
// 「機関が出していない（正常）」と「取得失敗（要対応）」の区別（CLAUDE.md 最重要の前提7）は
// tender_documents に列が無く、authenticated から読めるデータには持たせていない
// （failure_code はtenders単位のみ）。このタスク（3-3）では「取得済／未取得」のみを表示し、
// 理由の区別は行わない。
import { Panel, Pill } from "@/components/ui";

export const DOC_KINDS = ["公告", "入札説明書", "仕様書", "数量表", "様式"] as const;

export type TenderDocumentRow = {
  kind: string;
  fetched: boolean;
  fetched_at: string | null;
  page_count: number | null;
  ocr_used: boolean;
};

export type TenderLotRow = {
  line_no: number;
  item: string;
  spec: string | null;
  qty: number | string | null;
  unit: string | null;
  trade: string | null;
};

export function DocsTab({
  documents,
  lots,
  sourceUrl,
}: {
  documents: TenderDocumentRow[];
  lots: TenderLotRow[];
  sourceUrl: string | null;
}) {
  const got = DOC_KINDS.filter((kind) => documents.some((d) => d.kind === kind && d.fetched));
  const missing = DOC_KINDS.length - got.length;

  return (
    <div className="space-y-3">
      <Panel title="本部による取得">
        <div className="flex flex-wrap items-center gap-2">
          {missing === 0 ? (
            <Pill tone="green">取得できるものは揃っています</Pill>
          ) : (
            <Pill tone="amber">取得できていない資料が{missing}件</Pill>
          )}
        </div>
        <p className="mt-1.5 text-xs leading-relaxed text-slate-600">
          取得済 {got.length}/{DOC_KINDS.length}件
        </p>
        <p className="mt-1 text-xs text-slate-400">AI解析のための取得です。取得できた資料の原本はお渡ししていません。</p>
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
              {DOC_KINDS.map((kind) => {
                const doc = documents.find((d) => d.kind === kind && d.fetched);
                return (
                  <tr key={kind} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-medium">{kind}</td>
                    <td className="px-2 py-2">
                      {doc ? <Pill tone="green">取得済</Pill> : <Pill tone="rose">未取得</Pill>}
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
        {sourceUrl && (
          <div className="border-t border-slate-200 px-3 py-2 text-xs text-slate-500">
            公告元URL：<span className="break-all text-slate-700">{sourceUrl}</span>
          </div>
        )}
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
