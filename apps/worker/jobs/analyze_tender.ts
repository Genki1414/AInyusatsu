// AI解析結果の保存（タスク2-4・2-5・2-3b）。1案件をその場で解析する。
// 参照：docs/実装仕様書_v1.md §2（tenders/tender_analyses/tender_forms/tender_lots）, §4
//
// プロンプト1（基本情報と期限）・2（参加資格と参加条件）・3（数量表の構造化と業種割当）・
// 4（提出書類）・5（注意事項）を実行し、結果をDBへ保存する。あわせて期限の前後関係・
// 和暦変換ミスの検出（タスク2-3b、docs/AI解析プロンプト集.md §1）を行い、違反があれば
// tenders.needs_reviewを立てる。
//
// 資料の読み込みとDBへの書き戻しは analysis_shared.ts に置き、バッチ実行
// （analyze_tenders_batch.ts）と共通にしている。ここにあるのは「どの順で何本走らせるか」だけ。
//
// 【スコープ外・別タスク】
// - プロンプト6（質問案の生成）は org 単位の questions テーブル向け（1案件×1org）で、
//   全ユーザー共通のこの解析パイプラインには含まない。UI（タスク3系）からオンデマンドで
//   呼ぶ想定
// - tenders.name / agency は、GEPS/KKJの一次情報（コネクタ）を正としてAI解析では
//   上書きしない（agency_idの名寄せに影響するため）
// - tender_lotsにはevidence/source列が無いため、行ごとの引用・出典は保持しない
//   （tender_analyses.raw.lotsに完全な出力を残しているので、必要ならそちらを参照する）

import { createServiceClient } from "@ai-nyusatsu-bu/db";
import {
  analyzeBasicInfo,
  analyzeForms,
  analyzeLots,
  analyzeNotes,
  analyzeQualifications,
  callClaude,
  estimateDocumentTokens,
  EXPENSIVE_TOKENS,
  formatUsageSummary,
  summarizeUsage,
  type ModelUsage,
  type OnInvalid,
  type OnUsage,
  type UsageSummary,
} from "@ai-nyusatsu-bu/ai";
import {
  collectPromptFailures,
  loadTenderForAnalysis,
  persistAnalysis,
  recordAnalysisFailure,
  settle,
  valueOr,
} from "./analysis_shared";

export type AnalyzeTenderResult = {
  tenderId: string;
  analysisVersion: number;
  tenderFieldsFilled: string[];
  formsCount: number;
  lotsCount: number;
  needsReview: boolean;
  reviewReasons: string[];
  /** 失敗したプロンプト名。空なら5本すべて成功している */
  failedPrompts: string[];
  /** トークン消費とプロンプトキャッシュの効き具合 */
  usage: UsageSummary;
};

/** 1案件を解析し、tenders/tender_analyses/tender_formsへ保存する。 */
export async function analyzeTender(tenderId: string): Promise<AnalyzeTenderResult> {
  const client = createServiceClient();
  const input = await loadTenderForAnalysis(client, tenderId);

  // 資料が極端に大きい案件は1件で数百円かかる。自動で回すと気づけないので、
  // 実行前に見えるようにしておく（上限のガードは buildAnalysisPrompt が持っている）。
  const documentTokens = estimateDocumentTokens(input.documents);
  if (documentTokens >= EXPENSIVE_TOKENS) {
    console.warn(
      `[analyze_tender] 資料が大きい案件です（推定${documentTokens.toLocaleString("ja-JP")}トークン）。` +
        `1件あたりの費用が平均の数倍になります（tender=${tenderId}）`,
    );
  }

  // スキーマ不一致の理由を捨てない（CLAUDE.md「エラーは握りつぶさない」）。
  // 2回失敗するとParseInvalidErrorになるが、それだけでは「どの項目がなぜ弾かれたか」が
  // 分からず調査できないため、試行ごとに理由を標準エラー出力へ残す。
  const onInvalid: OnInvalid = ({ promptName, attempt, issue, raw }) => {
    // ErrorはJSON.stringifyすると{}になり原因が分からなくなるため、messageを取り出す。
    // JSONとして壊れている場合はissueだけでは判断できないので、生出力の末尾も添える
    // （末尾を見るのは、出力が長すぎて途中で切れたかを判別するため）。
    const detail = issue instanceof Error ? `${issue.name}: ${issue.message}` : JSON.stringify(issue, null, 2);
    console.error(`[analyze_tender] スキーマ不一致（prompt=${promptName}, attempt=${attempt}）: ${detail}`);
    console.error(`[analyze_tender] 生出力の末尾200文字: ${JSON.stringify(raw.slice(-200))}（全${raw.length}文字）`);
  };

  // 実際のトークン消費を集めて、プロンプトキャッシュが効いているかを残す。
  // キャッシュは外れても失敗としては現れず、請求額に静かに出るだけなので計測する。
  const usages: ModelUsage[] = [];
  const onUsage: OnUsage = (usage) => usages.push(usage);
  const run = { meta: input.meta, documents: input.documents, callModel: callClaude, onInvalid, onUsage };

  // 5本のうち1本が失敗しても、成功した分は保存する（CLAUDE.md 最重要の前提7）。
  // Promise.allでは、たとえば注意事項の抽出が1回スキーマ不一致になっただけで、
  // 期限も数量表も丸ごと捨てていた。
  //
  // 【実行の順序】5本のプロンプトは前半（案件の既知情報＋資料）が完全に同じで、そこを
  // プロンプトキャッシュの対象にしている。5本を同時に投げると、1本目の書き込みが終わる前に
  // 残りが走ってしまい、全部がキャッシュミス＝満額になる。そのため基本情報を先に1本走らせて
  // キャッシュを作り、残り4本はそれを読む形にする。
  // 待ち時間は1本分（数十秒）増えるが、入力コストが約2/3下がる。
  const basicInfoR = await settle(analyzeBasicInfo(run));
  const [qualificationsR, lotsR, formsR, notesR] = await Promise.allSettled([
    analyzeQualifications(run),
    analyzeLots(run),
    analyzeForms(run),
    analyzeNotes(run),
  ]);
  const settled = [basicInfoR, qualificationsR, lotsR, formsR, notesR];
  const failures = collectPromptFailures([
    ["基本情報と期限", basicInfoR],
    ["参加資格と参加条件", qualificationsR],
    ["数量表の構造化と業種割当", lotsR],
    ["提出書類", formsR],
    ["注意事項", notesR],
  ]);
  if (failures.length === settled.length) {
    // 1本も成功していないなら保存できるものが無い。理由をDBに残してから失敗として扱う
    // （自動実行では例外がログに流れて終わるため、案件側にも残さないと気づけない）。
    await recordAnalysisFailure(client, tenderId, failures);
    throw new Error(`AI解析がすべて失敗しました: ${failures.map((f) => f.message).join(" / ")}`);
  }

  const saved = await persistAnalysis(
    client,
    input,
    {
      basicInfo: valueOr(basicInfoR),
      qualifications: valueOr(qualificationsR),
      lots: valueOr(lotsR),
      forms: valueOr(formsR),
      notes: valueOr(notesR),
    },
    failures,
  );

  const usage = summarizeUsage(usages);
  console.log(`[analyze_tender] トークン消費（tender=${tenderId}）: ${formatUsageSummary(usage)}`);
  if (usage.cacheReadTokens === 0 && usage.calls > 1) {
    // 2本目以降が1つもキャッシュに当たっていない＝前半の文字列がぶれているか、
    // 有効期間を過ぎている。放置すると入力コストが3倍のままになるので気づけるようにする。
    console.warn("[analyze_tender] プロンプトキャッシュが1度も効いていません。共通部分の組み立てを確認してください");
  }

  return {
    tenderId,
    ...saved,
    failedPrompts: failures.map((f) => f.promptName),
    usage,
  };
}
