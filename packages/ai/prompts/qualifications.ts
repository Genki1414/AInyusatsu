// AI解析プロンプト集.md §2「参加資格と参加条件」。追加の指示の本文はそのまま使う（書き換えない）。

export const QUALIFICATIONS_SCHEMA_DESCRIPTION = `{
  "qualifications": [
    { "text": "string", "category": "資格|等級|地域|実績|認証・許可|体制|その他",
      "quote": "string", "source": "string" }
  ],
  "conditions": [
    { "text": "string", "quote": "string", "source": "string" }
  ],
  "unknown_reason": "string|null"
}`;

export const QUALIFICATIONS_INSTRUCTIONS = `・1つの条件に複数の要件が含まれる場合は、分割して1行ずつにしてください
  例:「東京都内に本店または営業所を有し、かつ同種業務の実績を1件以上有する者」
    → 2行に分ける（体制／実績）

・category の判断
  - 資格: 全省庁統一資格の区分（役務の提供等 など）
  - 等級: A・B・C・D の格付け要件
  - 地域: 競争参加地域、本店・営業所の所在地要件
  - 実績: 同種業務の実績、施工実績
  - 認証・許可: 建築物環境衛生総合管理業の登録、警備業の認定、産業廃棄物処理業の許可 など
  - 体制: 有資格者の配置、対処拠点、常駐要員 など
  - その他: 上記に当てはまらないもの

・「〜でないこと」（欠格要件）も conditions に含めてください
・予算決算及び会計令第70条・第71条の一般的な欠格条項は、1行にまとめて構いません`;
