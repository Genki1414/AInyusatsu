// 適合判定（タスク3-1）。案件と企業プロファイル・条件セットを突き合わせてスコアを出す。
// 参照：docs/実装仕様書_v1.md §7「提案エンジン」
//
// 配点（合計100）：資格区分20／営業品目20／等級15／競争参加地域15／予定価格10／
//                 残日数10／協力会社の保有10
// 「資格区分・営業品目・等級のいずれか未充足 → 対象外」が唯一のゲート。地域・予定価格・
// 残日数・協力会社の保有は加点要素のみで対象外にはしない。
// 未充足（確定的な不一致）と未確認（値が取れていない）は区別する。未確認は0点かつ
// reasonsNgに記録するだけで、対象外にはしない（「推測しない・隠さない」方針のため）。

import { daysUntilDeadline } from "./deadline";

export type FitTender = {
  agencyId: string;
  qualCategory: string | null; // 役務の提供等 / 物品の販売 等
  item: string | null; // 営業品目
  grade: string | null; // 'B以上' 等。制限なしはnull
  areas: string[]; // 競争参加地域
  budget: number | null; // 予定価格。非公表はnull
  submitDeadline: string | null; // 提出期限（ISO 8601）
  name: string;
  specText: string; // 仕様書本文（キーワード判定に使う。無ければ空文字）
  trades: string[]; // 案件に必要な業種一覧（数量表 tender_lots.trade 由来）
};

export type FitCompanyProfile = {
  qualCategories: string[];
  grades: Record<string, string>; // {"役務の提供等": "B"}
  items: string[];
  areas: string[];
};

export type FitCriteriaSet = {
  items: string[]; // 空配列＝company側の営業品目をそのまま使う（絞り込みなし）
  areas: string[]; // 空配列＝company側の地域をそのまま使う（絞り込みなし）
  keywords: string[];
  ngWords: string[];
  ngAgencies: string[];
  minBudget: number | null;
  maxBudget: number | null;
  minDays: number;
};

export type FitContext = {
  partnerTrades: string[]; // 稼働中の協力会社が対応できる業種一覧
  now: Date;
};

export type FitScoreBreakdown = {
  qualCategory: number;
  item: number;
  grade: number;
  areas: number;
  budget: number;
  daysLeft: number;
  partners: number;
};

export type FitResult = {
  eligible: boolean;
  score: number;
  breakdown: FitScoreBreakdown;
  reasonsOk: string[];
  reasonsNg: string[];
  excludedReason: string | null;
};

const GRADE_ORDER = ["A", "B", "C", "D"] as const;

function gradeRank(grade: string): number {
  const idx = GRADE_ORDER.indexOf(grade as (typeof GRADE_ORDER)[number]);
  return idx === -1 ? Number.POSITIVE_INFINITY : idx;
}

/**
 * 等級要件（例："B以上" "C又はD" "B"）を自社の等級が満たすか判定する。
 * 要件が無い（null）場合は制限なしとしてtrue。
 */
export function meetsGradeRequirement(required: string | null, companyGrade: string | null): boolean {
  if (!required) return true;
  if (!companyGrade) return false;
  const req = required.trim();
  if (req.endsWith("以上")) {
    const base = req.slice(0, -2).trim();
    return gradeRank(companyGrade) <= gradeRank(base);
  }
  const orSplit = req
    .split(/又は|または|・|、|,/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (orSplit.length > 1) {
    return orSplit.includes(companyGrade);
  }
  return companyGrade === req;
}

function containsAny(haystack: string, needles: string[]): string | null {
  return needles.find((needle) => needle.length > 0 && haystack.includes(needle)) ?? null;
}

export function evaluateFit(
  tender: FitTender,
  company: FitCompanyProfile,
  criteria: FitCriteriaSet,
  context: FitContext,
): FitResult {
  const reasonsOk: string[] = [];
  const reasonsNg: string[] = [];
  const excludeReasons: string[] = [];
  const text = `${tender.name}\n${tender.specText}`;

  if (criteria.ngAgencies.includes(tender.agencyId)) {
    excludeReasons.push("除外対象の発注機関です");
  }

  const ngWordHit = containsAny(text, criteria.ngWords);
  if (ngWordHit) {
    excludeReasons.push(`除外キーワード「${ngWordHit}」に一致しました`);
  }

  if (criteria.keywords.length > 0 && !containsAny(text, criteria.keywords)) {
    excludeReasons.push("指定キーワードのいずれにも一致しません");
  }

  // 資格区分（20点・ゲート）
  let qualCategoryScore = 0;
  if (tender.qualCategory === null) {
    reasonsNg.push("資格区分が未確認のため判定できません");
  } else if (company.qualCategories.includes(tender.qualCategory)) {
    qualCategoryScore = 20;
    reasonsOk.push(`資格区分「${tender.qualCategory}」を保有しています`);
  } else {
    reasonsNg.push(`資格区分「${tender.qualCategory}」を保有していません`);
    excludeReasons.push(`資格区分「${tender.qualCategory}」を保有していません`);
  }

  // 営業品目（20点・ゲート）
  const effectiveItems = criteria.items.length > 0 ? company.items.filter((i) => criteria.items.includes(i)) : company.items;
  let itemScore = 0;
  if (tender.item === null) {
    reasonsNg.push("営業品目が未確認のため判定できません");
  } else if (effectiveItems.includes(tender.item)) {
    itemScore = 20;
    reasonsOk.push(`営業品目「${tender.item}」に対応しています`);
  } else {
    reasonsNg.push(`営業品目「${tender.item}」に対応していません`);
    excludeReasons.push(`営業品目「${tender.item}」に対応していません`);
  }

  // 等級（15点・ゲート）
  const companyGrade = tender.qualCategory ? (company.grades[tender.qualCategory] ?? null) : null;
  let gradeScore = 0;
  if (tender.grade === null) {
    gradeScore = 15;
    reasonsOk.push("等級の指定はありません");
  } else if (companyGrade === null) {
    reasonsNg.push("自社の等級情報が未登録のため判定できません");
  } else if (meetsGradeRequirement(tender.grade, companyGrade)) {
    gradeScore = 15;
    reasonsOk.push(`等級要件「${tender.grade}」を満たしています（自社: ${companyGrade}）`);
  } else {
    reasonsNg.push(`等級要件「${tender.grade}」を満たしていません（自社: ${companyGrade}）`);
    excludeReasons.push(`等級要件「${tender.grade}」を満たしていません（自社: ${companyGrade}）`);
  }

  // 競争参加地域（15点・加点のみ）
  const effectiveAreas = criteria.areas.length > 0 ? company.areas.filter((a) => criteria.areas.includes(a)) : company.areas;
  let areasScore = 0;
  if (tender.areas.length === 0) {
    areasScore = 15;
    reasonsOk.push("地域の指定はありません");
  } else if (tender.areas.some((a) => effectiveAreas.includes(a))) {
    areasScore = 15;
    reasonsOk.push("競争参加地域に対応しています");
  } else {
    reasonsNg.push("競争参加地域に対応していません");
  }

  // 予定価格（10点・加点のみ）
  let budgetScore = 0;
  if (tender.budget === null) {
    budgetScore = 5;
    reasonsOk.push("予定価格は非公表です（中立）");
  } else {
    const aboveMin = criteria.minBudget === null || tender.budget >= criteria.minBudget;
    const belowMax = criteria.maxBudget === null || tender.budget <= criteria.maxBudget;
    if (aboveMin && belowMax) {
      budgetScore = 10;
      reasonsOk.push("予定価格が希望範囲内です");
    } else {
      reasonsNg.push("予定価格が希望範囲外です");
    }
  }

  // 残日数（10点・加点のみ）
  let daysLeftScore = 0;
  if (tender.submitDeadline === null) {
    reasonsNg.push("提出期限が未確認のため残日数を判定できません");
  } else {
    const deadline = new Date(tender.submitDeadline);
    if (Number.isNaN(deadline.getTime())) {
      reasonsNg.push("提出期限が未確認のため残日数を判定できません");
    } else {
      // 数え方は画面の表示と揃える（deadline.ts）。時刻で数字が変わると、
      // 同じ案件が朝と夜で違う点数になる
      const daysLeft = daysUntilDeadline(tender.submitDeadline, context.now) ?? 0;
      if (daysLeft < 0) {
        reasonsNg.push("提出期限を過ぎています");
      } else if (daysLeft < criteria.minDays) {
        reasonsNg.push(`残り${daysLeft}日は必要日数（${criteria.minDays}日）を下回っています`);
      } else {
        daysLeftScore = 10;
        reasonsOk.push(`残り${daysLeft}日で必要日数（${criteria.minDays}日）を満たしています`);
      }
    }
  }

  // 協力会社の保有（10点・加点のみ）
  const requiredTrades = Array.from(new Set(tender.trades));
  let partnersScore = 0;
  if (requiredTrades.length === 0) {
    partnersScore = 10;
    reasonsOk.push("必要な業種はありません");
  } else {
    const matched = requiredTrades.filter((t) => context.partnerTrades.includes(t));
    const ratio = matched.length / requiredTrades.length;
    partnersScore = Math.round(ratio * 10);
    if (matched.length === requiredTrades.length) {
      reasonsOk.push("必要業種すべてに対応する協力会社があります");
    } else if (matched.length > 0) {
      reasonsOk.push(`必要業種${requiredTrades.length}件中${matched.length}件に対応する協力会社があります`);
    } else {
      reasonsNg.push("必要業種に対応する協力会社がありません");
    }
  }

  const breakdown: FitScoreBreakdown = {
    qualCategory: qualCategoryScore,
    item: itemScore,
    grade: gradeScore,
    areas: areasScore,
    budget: budgetScore,
    daysLeft: daysLeftScore,
    partners: partnersScore,
  };
  const score = Object.values(breakdown).reduce((sum, v) => sum + v, 0);

  return {
    eligible: excludeReasons.length === 0,
    score,
    breakdown,
    reasonsOk,
    reasonsNg,
    excludedReason: excludeReasons.length > 0 ? excludeReasons.join("／") : null,
  };
}
