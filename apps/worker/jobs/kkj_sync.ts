// 官公需情報ポータル（KKJ）の同期ジョブ（タスク1-5）。
// 参照：docs/reference/KKJ_api_guide.pdf、docs/reference/KKJ_API_確認事項.md
//
// 資料の取得は行わない（KKJのExternalDocumentURIは他省庁サイトの公告掲載URLであり、
// 資料一式のダウンロードは調達ポータル（GEPS）側の役割。§CLAUDE.md「本部が必ず資料を取得する」）。
// ここではtendersへのupsertのみ行い、source_urlに公告掲載URLを保持する。

import { agencyIdFromName, dedupeKey, type NormalizedKkjTender } from "@ai-nyusatsu-bu/domain";
import { createServiceClient } from "@ai-nyusatsu-bu/db";
import { recordAgencySuccess } from "./coverage_check";
import { fetchItemsByDate } from "../connectors/kkj";

export type KkjSyncSummary = {
  date: string;
  found: number;
  merged: number;
  skipped: number; // 機関名が取れず投入できなかった件数（推測しない）
  status: "completed" | "failed";
};

async function ensureAgency(client: ReturnType<typeof createServiceClient>, agencyId: string, agencyName: string) {
  const { error } = await client
    .from("agencies")
    .upsert(
      {
        id: agencyId,
        name: agencyName,
        category: "発注機関", // KKJ経由で発見した機関。個別クロール対象ではないため詳細分類はしない
        parent_id: null,
        sources: [],
        active: true,
      },
      { onConflict: "id", ignoreDuplicates: true },
    );
  if (error) throw new Error(`agenciesのupsertに失敗しました: ${error.message}`);
}

async function upsertTender(
  client: ReturnType<typeof createServiceClient>,
  tender: NormalizedKkjTender,
  agencyId: string,
  key: string,
) {
  const { error } = await client.from("tenders").upsert(
    {
      code: tender.sourceKey,
      dedupe_key: key,
      agency_id: agencyId,
      name: tender.name,
      procurement: tender.procurement,
      qual_category: "未判定", // KKJの検索結果からは確定できない。推測しない（資料取得方針_v3.md）
      grade: tender.grade,
      place: tender.place,
      notice_date: tender.noticeDate,
      bid_open_at: tender.bidOpenAt,
      term_to: tender.periodEndTime,
      source_url: tender.noticeUrl || null,
      acquire_method: "公開Web",
      connector_id: "kkj",
      fetched_at: new Date().toISOString(),
    },
    { onConflict: "dedupe_key" },
  );
  if (error) throw new Error(`tendersのupsertに失敗しました（${tender.sourceKey}）: ${error.message}`);
}

/**
 * 指定日（公告日=CFT_Issue_Date）ぶんを同期する。crawl_runsに記録する。
 * 機関名（OrganizationName）が取れない案件は、agency_idを確定できないためスキップする
 * （tenders.agency_idはNOT NULLの外部キーであり、推測で埋めない）。
 */
export async function runKkjSync(dateIso: string): Promise<KkjSyncSummary> {
  const client = createServiceClient();

  const { data: run, error: runError } = await client
    .from("crawl_runs")
    .insert({ connector_id: "kkj", status: "running" })
    .select("id")
    .single<{ id: string }>();
  if (runError) throw new Error(`crawl_runsの記録に失敗しました: ${runError.message}`);

  let found = 0;
  let merged = 0;
  let skipped = 0;
  let status: KkjSyncSummary["status"] = "completed";
  // 取得できた機関。欠測検知（coverage_check）の基準になる last_success_at を更新する
  const succeededAgencies = new Set<string>();

  try {
    const result = await fetchItemsByDate(dateIso);
    found = result.items.length;

    for (const tender of result.items) {
      if (!tender.agencyName) {
        skipped++;
        continue;
      }
      const agencyId = agencyIdFromName(tender.agencyName);
      const key = dedupeKey({
        agencyId,
        noticeNo: null, // KKJのKeyはシステム内部の一意キーであり、公示上の受付番号ではないため使わない
        name: tender.name,
        submitDeadline: null, // 提出期限はKKJから取得しない（TenderSubmissionDeadlineの意味が仕様書内で矛盾するため）
      });
      await ensureAgency(client, agencyId, tender.agencyName);
      await upsertTender(client, tender, agencyId, key);
      succeededAgencies.add(agencyId);
      merged++;
    }

    // 取れたことを記録する。ここが無いと「取れていない」と区別がつかない
    await recordAgencySuccess(client, succeededAgencies);
  } catch (err) {
    status = "failed";
    await client.from("crawl_errors").insert({
      run_id: run.id,
      // KKJは画面ではなくAPIのため「レイアウト変更」の概念が薄い。HTTP失敗・エラーレスポンス
      // ・想定と異なるXML構造はいずれも「期待した形式で結果が返らなかった」点で共通するため、
      // 固定コードのうちPARSE_INVALIDに寄せる。
      code: "PARSE_INVALID",
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
        documents: 0,
        failed: skipped,
        status,
      })
      .eq("id", run.id);
  }

  return { date: dateIso, found, merged, skipped, status };
}
