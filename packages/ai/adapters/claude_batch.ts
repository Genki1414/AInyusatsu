// Claude Batch API の呼び出し口（コスト対策③の骨格）。
// CLAUDE.md「外部サービスは packages/*/adapters 経由でのみ呼ぶ」に従い、
// バッチの投入・状態確認・結果回収をここに閉じ込める。
//
// Batch API は全トークンが50%引きになる代わりに、処理のタイミングを制御できない
// （たいてい1時間以内、最大24時間）。結果は投入順に返らないため、必ず custom_id で
// 突き合わせる（src/batch_plan.ts）。
//
// 【未検証】バッチ実行でプロンプトキャッシュがどれだけ効くかは、実データで測るまで
// 分からない。書き込みと読み出しが別々のバッチになり、その間隔を制御できないためで、
// 有効期間は1時間を指定しているが、それでも外れうる。
// 削減率を見込む前に、必ず collectBatchResults の usage で実測すること。

import Anthropic from "@anthropic-ai/sdk";
import { SYSTEM_PROMPT } from "../prompts/system";
import { buildAnalysisPrompt, type AnalysisPromptName } from "../src/analyze";
import type { PromptDocument, TenderMeta } from "../prompts/user_template";
import { buildCustomId, promptsForStage, type BatchStage, type BatchResultEntry } from "../src/batch_plan";
import type { TokenUsage, UserPrompt } from "../src/extract";

const MODEL = "claude-sonnet-5";
const MAX_TOKENS = 32768;

/**
 * バッチでのキャッシュ有効期間。
 * 第1段（書き込み）と第2段（読み出し）が別のバッチになり、その間隔を制御できないため、
 * 同期実行の5分ではなく1時間を指定する。書き込みの課金は1.25倍から2倍に上がるが、
 * 外れて満額になるよりは安い。
 */
const CACHE_TTL = "1h" as const;

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (client) return client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY が設定されていません（.envを確認してください）");
  }
  client = new Anthropic({ apiKey });
  return client;
}

function userContent(user: UserPrompt) {
  if (user.cachedPrefix === null) return user.body;
  return [
    { type: "text" as const, text: user.cachedPrefix, cache_control: { type: "ephemeral" as const, ttl: CACHE_TTL } },
    { type: "text" as const, text: user.body },
  ];
}

/** バッチに入れる1案件ぶんの入力。 */
export type BatchTenderInput = {
  tenderId: string;
  meta: TenderMeta;
  documents: PromptDocument[];
};

type BatchRequest = {
  custom_id: string;
  params: {
    model: string;
    max_tokens: number;
    system: string;
    messages: { role: "user"; content: ReturnType<typeof userContent> }[];
  };
};

/**
 * その段で投入するリクエストを組み立てる。
 * 第1段は基本情報だけ（資料をキャッシュへ書き込む）、第2段は残り4本。
 */
export function buildBatchRequests(tenders: BatchTenderInput[], stage: BatchStage): BatchRequest[] {
  const prompts = promptsForStage(stage);
  return tenders.flatMap((tender) =>
    prompts.map((promptName: AnalysisPromptName) => ({
      custom_id: buildCustomId(tender.tenderId, promptName),
      params: {
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user" as const,
            content: userContent(buildAnalysisPrompt(promptName, tender.meta, tender.documents)),
          },
        ],
      },
    })),
  );
}

/** バッチを投入し、バッチIDを返す。リクエストが0件なら投入しない。 */
export async function submitBatch(requests: BatchRequest[]): Promise<{ batchId: string; requestCount: number } | null> {
  if (requests.length === 0) return null;
  const batch = await getClient().messages.batches.create({ requests });
  return { batchId: batch.id, requestCount: requests.length };
}

export type BatchStatus = {
  batchId: string;
  /** in_progress / canceling / ended */
  processingStatus: string;
  ended: boolean;
  counts: { processing: number; succeeded: number; errored: number; canceled: number; expired: number };
};

/** バッチの状態を1回だけ確認する。待ち合わせは呼び出し側の責務（ここでは待たない）。 */
export async function retrieveBatchStatus(batchId: string): Promise<BatchStatus> {
  const batch = await getClient().messages.batches.retrieve(batchId);
  return {
    batchId: batch.id,
    processingStatus: batch.processing_status,
    ended: batch.processing_status === "ended",
    counts: {
      processing: batch.request_counts.processing,
      succeeded: batch.request_counts.succeeded,
      errored: batch.request_counts.errored,
      canceled: batch.request_counts.canceled,
      expired: batch.request_counts.expired,
    },
  };
}

export type BatchCollection = {
  entries: BatchResultEntry[];
  /** 成功したリクエストのトークン消費。キャッシュが効いたかの実測に使う */
  usages: TokenUsage[];
};

/**
 * 終了したバッチの結果を回収する。
 * 失敗も expired も捨てずに entries へ入れる（CLAUDE.md「エラーは握りつぶさない」）。
 */
export async function collectBatchResults(batchId: string): Promise<BatchCollection> {
  const entries: BatchResultEntry[] = [];
  const usages: TokenUsage[] = [];

  for await (const result of await getClient().messages.batches.results(batchId)) {
    const customId = result.custom_id;
    if (result.result.type === "succeeded") {
      const message = result.result.message;
      usages.push({
        inputTokens: message.usage.input_tokens,
        cacheCreationTokens: message.usage.cache_creation_input_tokens ?? 0,
        cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
        outputTokens: message.usage.output_tokens,
      });

      if (message.stop_reason === "max_tokens") {
        // 途中で切れた出力をそのまま渡すと「壊れたJSON」として扱われ原因が分からなくなる。
        entries.push({
          customId,
          text: null,
          error: `出力が上限（max_tokens=${MAX_TOKENS}）に達して途中で切れました`,
        });
        continue;
      }

      const text = message.content
        .filter((block): block is Extract<typeof block, { type: "text" }> => block.type === "text")
        .map((block) => block.text)
        .join("");
      entries.push(
        text === ""
          ? { customId, text: null, error: `応答にテキストが含まれていません（stop_reason=${message.stop_reason}）` }
          : { customId, text, error: null },
      );
      continue;
    }

    if (result.result.type === "errored") {
      entries.push({ customId, text: null, error: `${result.result.error.type}` });
      continue;
    }
    entries.push({ customId, text: null, error: result.result.type }); // canceled / expired
  }

  return { entries, usages };
}

/** 投入したバッチを取り消す。投入し直したいときに使う。 */
export async function cancelBatch(batchId: string): Promise<string> {
  const cancelled = await getClient().messages.batches.cancel(batchId);
  return cancelled.processing_status;
}
