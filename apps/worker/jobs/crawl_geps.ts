// 調達ポータル（GEPS）の巡回ジョブ（タスク1-7）。
// 参照：docs/調達ポータルコネクタ設計.md §2, §2-5
//
// 1日・1分類（物品/役務）ずつ検索し、tendersへupsert、資料をStorageへ保存する。
// 収集端末（IC）は使わない（ユーザー指示）。全工程をクラウドのワーカーで完結させる。

import { createHash } from "node:crypto";
import { createServiceClient } from "@ai-nyusatsu-bu/db";
import type { GepsCategory, NormalizedGepsTender } from "@ai-nyusatsu-bu/domain";
import { crawlDate, type GepsDocument } from "../connectors/geps";

const CATEGORIES: GepsCategory[] = ["物品", "役務"];
const BUCKET = process.env.TENDER_DOCUMENTS_BUCKET || "tender-documents";

export type CrawlDateSummary = {
  date: string;
  found: number;
  merged: number;
  documents: number;
  failed: number;
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
        const storageKey = `tenders/${tenderId}/${doc.kind}_${sha256}.${ext}`;

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

/** 1日・1分類ぶんを巡回し、tenders/tender_documentsへ反映する。crawl_runsに記録する。 */
export async function runGepsCrawlForCategory(
  dateIso: string,
  category: GepsCategory,
): Promise<CrawlDateSummary> {
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
  let truncated = false;
  let status: CrawlDateSummary["status"] = "completed";

  try {
    const result = await crawlDate(dateIso, category);
    found = result.count;
    truncated = result.truncated;

    for (const tender of result.tenders) {
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
      payload: { dateIso, category },
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

  return { date: dateIso, found, merged, documents, failed: failedDocs, truncated, status };
}

/** 前日ぶんを、物品・役務の両分類で巡回する。 */
export async function runDailyGepsCrawl(dateIso: string): Promise<CrawlDateSummary[]> {
  const summaries: CrawlDateSummary[] = [];
  for (const category of CATEGORIES) {
    summaries.push(await runGepsCrawlForCategory(dateIso, category));
  }
  return summaries;
}
