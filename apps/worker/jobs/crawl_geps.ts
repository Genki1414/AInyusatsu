// 調達ポータル（GEPS）の巡回ジョブ（タスク1-7）。
// 参照：docs/調達ポータルコネクタ設計.md §2, §2-5
//
// 1日ぶんを検索し、tendersへupsert、資料をStorageへ保存する。
// 収集端末（IC）は使わない（ユーザー指示）。全工程をクラウドのワーカーで完結させる。
//
// 実データ確認済み（2026-08-01）：検索フォームは物品だけ・役務だけを絞り込む手段が無いため、
// 以前の「物品・役務で2回巡回する」設計は同じ結果を2回取得するだけでなく、2回の独立した
// ブラウザセッション間で機関名抽出にわずかな差異が出ると同じcodeで異なるdedupe_keyになり
// tenders_code_key制約違反を起こすことが実機で判明した。1日1回の巡回に修正済み。

import { createHash } from "node:crypto";
import { createServiceClient } from "@ai-nyusatsu-bu/db";
import type { DocKind, NormalizedGepsTender } from "@ai-nyusatsu-bu/domain";
import { crawlDate, type GepsDocument } from "../connectors/geps";

const BUCKET = process.env.TENDER_DOCUMENTS_BUCKET || "tender-documents";

/**
 * Supabase Storageのキーは日本語（非ASCII文字）を許可せず、"Invalid key"エラーになる
 * （実機確認済み・2026-08-03）。DocKindは表示用に日本語ラベルのままDB（tender_documentsの
 * kind列）へ保存しつつ、Storageのキーだけこの英語スラッグに変換する。
 */
const DOC_KIND_SLUG: Record<DocKind, string> = {
  公告: "notice",
  入札説明書: "guideline",
  仕様書: "spec",
  数量表: "quantity",
  様式: "form",
  その他: "other",
};

export type CrawlDateSummary = {
  date: string;
  found: number;
  merged: number;
  documents: number;
  failed: number;
  /**
   * 詳細画面から調達案件番号が取得できず、tendersへ投入せずスキップした件数。
   * 実データではページごとに細かな表記ゆれがあり、1件の抽出失敗でジョブ全体を
   * 止めないようにするため、推測で埋めずスキップする方針にした（推測しない）。
   */
  skipped: number;
  truncated: boolean;
  status: "completed" | "truncated" | "failed";
};

async function ensureAgency(client: ReturnType<typeof createServiceClient>, tender: NormalizedGepsTender) {
  const { error } = await client
    .from("agencies")
    .upsert(
      {
        id: tender.agencyId,
        name: tender.agencyName,
        category: "発注機関", // GEPS経由で発見した機関。個別クロール対象ではないため詳細分類はしない
        parent_id: null,
        sources: [],
        active: true,
      },
      { onConflict: "id", ignoreDuplicates: true },
    );
  if (error) throw new Error(`agenciesのupsertに失敗しました: ${error.message}`);
}

async function upsertTender(client: ReturnType<typeof createServiceClient>, tender: NormalizedGepsTender) {
  const { data, error } = await client
    .from("tenders")
    .upsert(
      {
        code: tender.code,
        dedupe_key: tender.dedupeKey,
        agency_id: tender.agencyId,
        notice_no: tender.procurementNo,
        name: tender.name,
        procurement: tender.procurement,
        qual_category: tender.qualCategory,
        place: tender.place,
        notice_date: tender.noticeDate,
        source_url: tender.sourceUrl,
        acquire_method: "電子調達",
        connector_id: "geps",
        fetched_at: new Date().toISOString(),
      },
      { onConflict: "dedupe_key" },
    )
    .select("id")
    .single<{ id: string }>();
  if (error) throw new Error(`tendersのupsertに失敗しました（${tender.code}）: ${error.message}`);
  return data.id;
}

async function saveDocuments(
  client: ReturnType<typeof createServiceClient>,
  tenderId: string,
  docs: GepsDocument[],
): Promise<{ saved: number; failed: number }> {
  let saved = 0;
  let failed = 0;

  for (const doc of docs) {
    try {
      const sha256 = createHash("sha256").update(doc.buffer).digest("hex");

      const { data: existing } = await client
        .from("tender_documents")
        .select("id")
        .eq("tender_id", tenderId)
        .eq("kind", doc.kind)
        .eq("sha256", sha256)
        .maybeSingle();

      if (!existing) {
        const ext = doc.filename.includes(".") ? doc.filename.split(".").pop() : "bin";
        const storageKey = `tenders/${tenderId}/${DOC_KIND_SLUG[doc.kind]}_${sha256}.${ext}`;

        const { error: uploadError } = await client.storage
          .from(BUCKET)
          .upload(storageKey, doc.buffer, { upsert: true });
        if (uploadError) throw new Error(uploadError.message);

        const { error: insertError } = await client.from("tender_documents").insert({
          tender_id: tenderId,
          kind: doc.kind,
          fetched: true,
          storage_key: storageKey,
          sha256,
          fetched_at: new Date().toISOString(),
        });
        if (insertError) throw new Error(insertError.message);
      }
      saved++;
    } catch (err) {
      failed++;
      // eslint-disable-next-line no-console
      console.error(`資料の保存に失敗しました（tender=${tenderId}, file=${doc.filename}）`, err);
    }
  }

  if (saved > 0) {
    await client.from("tenders").update({ collect_status: "取得済" }).eq("id", tenderId);
  }

  return { saved, failed };
}

/** 1日ぶんを巡回し、tenders/tender_documentsへ反映する。crawl_runsに記録する。 */
export async function runDailyGepsCrawl(dateIso: string): Promise<CrawlDateSummary> {
  const client = createServiceClient();

  const { data: run, error: runError } = await client
    .from("crawl_runs")
    .insert({ connector_id: "geps", status: "running" })
    .select("id")
    .single<{ id: string }>();
  if (runError) throw new Error(`crawl_runsの記録に失敗しました: ${runError.message}`);

  let found = 0;
  let merged = 0;
  let documents = 0;
  let failedDocs = 0;
  let skipped = 0;
  let truncated = false;
  let status: CrawlDateSummary["status"] = "completed";

  try {
    const result = await crawlDate(dateIso);
    found = result.count;
    truncated = result.truncated;

    for (const tenderError of result.tenderErrors) {
      // 検索やり直し・詳細画面取得がサイト側の遅延等で失敗した案件（crawlDate側で
      // 既にスキップ済み）。原因調査用にcrawl_errorsへ記録する（実機確認済み・2026-08-03）。
      skipped++;
      await client.from("crawl_errors").insert({
        run_id: run.id,
        code: "RATE_LIMITED",
        message: tenderError.message,
        payload: { dateIso, index: tenderError.index },
      });
      // eslint-disable-next-line no-console
      console.error(`検索・詳細取得に失敗しスキップしました（index=${tenderError.index}）: ${tenderError.message}`);
    }

    for (const tender of result.tenders) {
      if (!tender.procurementNo) {
        // 実データではページごとに細かな表記ゆれがあり、詳細画面から調達案件番号を
        // 取得できない案件が稀に発生する（tenders.codeがNOT NULL UNIQUEのため
        // 推測で埋めることはできない）。1件の抽出失敗でジョブ全体を止めないよう、
        // その案件だけスキップして続行する。原因調査用にcrawl_errorsへ記録する。
        skipped++;
        await client.from("crawl_errors").insert({
          run_id: run.id,
          code: "PARSE_INVALID",
          message: "詳細画面から調達案件番号を取得できませんでした",
          payload: { dateIso, name: tender.name, sourceUrl: tender.sourceUrl },
        });
        // eslint-disable-next-line no-console
        console.error(`調達案件番号が取得できずスキップしました: ${tender.name || tender.sourceUrl}`);
        continue;
      }

      await ensureAgency(client, tender);
      const tenderId = await upsertTender(client, tender);
      merged++;

      const docs = result.documentsByProcurementNo.get(tender.procurementNo) ?? [];
      if (docs.length > 0) {
        const { saved, failed } = await saveDocuments(client, tenderId, docs);
        documents += saved;
        failedDocs += failed;
      }
    }

    // 打ち切り（500件到達）は§6の既定コードのどれにも該当しないため、crawl_errorsには
    // 積まずcrawl_runs.status="truncated"のみで表現する（要対応の記録として残す）。
    status = truncated ? "truncated" : "completed";
  } catch (err) {
    status = "failed";
    await client.from("crawl_errors").insert({
      run_id: run.id,
      code: "LAYOUT_CHANGED",
      message: err instanceof Error ? err.message : String(err),
      payload: { dateIso },
    });
    throw err;
  } finally {
    await client
      .from("crawl_runs")
      .update({
        finished_at: new Date().toISOString(),
        found,
        merged,
        documents,
        failed: failedDocs,
        status,
      })
      .eq("id", run.id);
  }

  return { date: dateIso, found, merged, documents, failed: failedDocs, skipped, truncated, status };
}
