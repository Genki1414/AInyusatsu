// AI解析プロンプト集.md §1「基本情報と期限」。追加の指示の本文はそのまま使う（書き換えない）。

export const BASIC_INFO_SCHEMA_DESCRIPTION = `{
  "name": { "value": "string|null", "quote": "string|null", "source": "string|null" },
  "agency": { "value": "string|null", "quote": null, "source": null },
  "org_unit": { "value": "string|null", "quote": null, "source": null },
  "notice_no": { "value": "string|null", "quote": null, "source": null },
  "notice_date": { "value": "YYYY-MM-DD|null", "quote": null, "source": null },
  "submit_deadline": { "value": "YYYY-MM-DDTHH:mm|null", "quote": null, "source": null },
  "qa_deadline":     { "value": "YYYY-MM-DDTHH:mm|null", "quote": null, "source": null },
  "bid_open_at":     { "value": "YYYY-MM-DDTHH:mm|null", "quote": null, "source": null },
  "term_from": { "value": "YYYY-MM-DD|null", "quote": null, "source": null },
  "term_to":   { "value": "YYYY-MM-DD|null", "quote": null, "source": null },
  "place": { "value": "string|null", "quote": null, "source": null },
  "qual_category": { "value": "役務の提供等|物品の販売|物品の製造|null", "quote": null, "source": null },
  "item":  { "value": "string|null", "quote": null, "source": null },
  "grade": { "value": "string|null", "quote": null, "source": null },
  "areas": { "value": ["string"], "quote": null, "source": null },
  "budget": { "value": 0, "disclosed": true, "quote": null, "source": null },
  "jv_allowed": { "value": true, "quote": null, "source": null },
  "electronic_bidding": { "value": true, "quote": null, "source": null },
  "unknown_fields": ["string"]
}`;

export const BASIC_INFO_INSTRUCTIONS = `この抽出で特に注意すること:

・期限は3種類あります。混同しないでください
  - submit_deadline: 入札書（または参加表明書）の提出期限
  - qa_deadline: 質問・照会の受付期限
  - bid_open_at: 開札の日時
  資料に「入札書受領期限」「入札締切」とあれば submit_deadline です。
  「質問書の提出期限」「照会期限」は qa_deadline です。

・時刻が書かれていない日付は、時刻を 00:00 とせず、日付のみで返してください
・「令和8年7月7日」は 2026-07-07 です
・予定価格が「非公表」「事後公表」の場合は disclosed: false、value: null にします
・等級は「B以上」「C又はD」など原文の表記のまま value に入れてください。正規化しません
・areas は「関東・甲信越」のような競争参加地域の区分です。履行場所とは別です
・単体企業に限る旨の記載があれば jv_allowed: false です。記載がなければ null`;
