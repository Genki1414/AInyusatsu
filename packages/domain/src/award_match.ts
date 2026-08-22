// 過去の落札実績を、案件名で照合する。
//
// 【なぜ機関・品目で照合しないのか】
// 落札実績オープンデータには予定価格・品目分類・調達機関名称の列が無い
// （docs/reference/落札実績オープンデータ_列定義（推定）.md §1）。
// awards に入るのは 調達案件番号 / 案件名 / 落札日 / 落札金額 / 落札者名 / 法人番号 の6項目だけ。
// つまり awards.item も awards.agency_id も常に null で、そこでは照合できない。
//
// 【案件名で照合する】
// 役務の案件の多くは毎年度くり返される。案件名から年度の表記を外せば、
// 前年度の同じ案件を見つけられる。「昨年度は◯◯円で落札された」は、
// 統計的な相場よりも直接的な規模感の手がかりになる。
//
// 【実データの揺れ】
// 実際の落札実績の名称はこう並ぶ（2026-08-22 実データ確認）。
//   網走開発建設部本部外　消防用設備等点検業務
//   令和８年度管理施設消防用設備保守点検（武雄河川事務所）
//   （R8）第三吉島住宅ほか消防用設備等点検等業務
// 施設名がすべて違い、「等」「外」「ほか」「保守」の有無も揺れる。
// 完全一致・部分一致だけでは拾えないため、近さの判定も入れる。
//
// 照合は3段階にする。
//   完全一致：年度を外した名称が一致する（同じ案件のくり返しとみなせる）
//   部分一致：一方が他方を含む（名称に補足が付いただけの可能性がある）
//   類似：3文字単位の重なりが多い（Postgresのtrigram検索が返した候補）
//
// 近さの判定はPostgresのtrigram（pg_trgm）に任せる。語を分解して意味を推し量ることはしない
// （形態素解析なしの分解は推測になるため）。画面には必ず実際の名称を並べ、
// どれを参考にするかは利用者が判断できるようにする。

/** 部分一致で照合してよい最小の長さ。短い名称は関係ない案件まで拾ってしまう。 */
export const MIN_PARTIAL_MATCH_LENGTH = 8;

export type AwardNameMatchKind = "完全一致" | "部分一致" | "類似";

export type NameMatchableAward = {
  name: string | null;
  amount: number;
  openedAt: string | null;
  winnerName: string | null;
  /** trigram検索が返した近さ（0〜1）。名称で引いていない場合は null */
  similarity?: number | null;
};

export type MatchedAward = NameMatchableAward & { match: AwardNameMatchKind };

/** 全角の英数字を半角にする（同じ案件名でも表記が揺れるため）。 */
function toHalfWidth(value: string): string {
  return value.replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
}

/**
 * 案件名から年度の表記を外す。
 * 「令和８年度」「平成30年度」「R8年度」「2026年度」を対象にする。
 */
export function stripFiscalYear(name: string): string {
  return toHalfWidth(name)
    .replace(/(令和|平成|昭和)\s*(元|[0-9]+)\s*年度?/g, "")
    .replace(/\b(R|H|S)\s*[0-9]{1,2}\s*年度?/gi, "")
    .replace(/[0-9]{4}\s*年度/g, "");
}

/**
 * 照合用に案件名をそろえる。年度・空白・区切り記号を落とす。
 * 名称そのものを書き換えるわけではなく、比較のためだけに使う。
 */
export function normalizeAwardName(name: string): string {
  return stripFiscalYear(name)
    .replace(/[\s　]+/g, "")
    .replace(/[（）()「」『』【】［］[\]、,，。．・･/／\-ー―－_]/g, "");
}

/**
 * 候補の落札実績を、案件名との近さで3段階に分ける。
 *
 * 候補はPostgresのtrigram検索（find_similar_awards）が返したものを想定している。
 * ここでは「完全一致か」「部分一致か」を判定し、どちらでもないものは「類似」として残す。
 * 並び順は 完全一致 → 部分一致 → 類似。各段階の中では新しい落札から。
 */
export function matchAwardsByName(awards: NameMatchableAward[], tenderName: string): MatchedAward[] {
  const target = normalizeAwardName(tenderName);
  if (target === "") return [];

  const exact: MatchedAward[] = [];
  const partial: MatchedAward[] = [];
  const similar: MatchedAward[] = [];

  for (const award of awards) {
    if (award.name === null) continue;
    const candidate = normalizeAwardName(award.name);
    if (candidate === "") continue;

    if (candidate === target) {
      exact.push({ ...award, match: "完全一致" });
      continue;
    }
    const longEnough = target.length >= MIN_PARTIAL_MATCH_LENGTH && candidate.length >= MIN_PARTIAL_MATCH_LENGTH;
    if (longEnough && (candidate.includes(target) || target.includes(candidate))) {
      partial.push({ ...award, match: "部分一致" });
      continue;
    }
    // 近さの判定はtrigram検索に任せている。候補として返ってきた時点で近い
    if (award.similarity != null) {
      similar.push({ ...award, match: "類似" });
    }
  }

  const byNewest = (a: MatchedAward, b: MatchedAward) => (b.openedAt ?? "").localeCompare(a.openedAt ?? "");
  // 類似は近い順に見せる（新しさより、名称の近さのほうが手がかりになる）
  const bySimilarity = (a: MatchedAward, b: MatchedAward) => (b.similarity ?? 0) - (a.similarity ?? 0);
  return [...exact.sort(byNewest), ...partial.sort(byNewest), ...similar.sort(bySimilarity)];
}
