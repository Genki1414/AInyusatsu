// 設定画面の選択肢。docs/ai-nyusatsu-bu-prototype-v7.jsx の ConditionsView / QualView、
// packages/ai/src/schemas/basic_info.ts の QUAL_CATEGORIES に準拠する。
export const QUAL_CATEGORIES = ["役務の提供等", "物品の販売", "物品の製造"] as const;

export const ITEM_OPTIONS = [
  "建物管理等",
  "清掃",
  "警備",
  "植栽等管理",
  "什器類",
  "事務用品",
  "理化学機器",
  "情報処理",
  "運送",
  "廃棄物処理",
] as const;

export const AREA_OPTIONS = ["北海道", "東北", "関東・甲信越", "東海・北陸", "近畿", "中国", "四国", "九州・沖縄"] as const;
