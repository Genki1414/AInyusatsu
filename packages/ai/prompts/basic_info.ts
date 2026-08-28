// AI解析プロンプト集.md §1「基本情報と期限」。追加の指示の本文はそのまま使う（書き換えない）。

export const BASIC_INFO_SCHEMA_DESCRIPTION = `{
  "name": { "value": "string|null", "quote": "string|null", "source": "string|null" },
  "agency": { "value": "string|null", "quote": "string|null", "source": "string|null" },
  "org_unit": { "value": "string|null", "quote": "string|null", "source": "string|null" },
  "notice_no": { "value": "string|null", "quote": "string|null", "source": "string|null" },
  "notice_date": { "value": "YYYY-MM-DD|null", "quote": "string|null", "source": "string|null" },
  "submit_deadline": { "value": "YYYY-MM-DDTHH:mm|YYYY-MM-DD|null", "quote": "string|null", "source": "string|null" },
  "qa_deadline":     { "value": "YYYY-MM-DDTHH:mm|YYYY-MM-DD|null", "quote": "string|null", "source": "string|null" },
  "bid_open_at":     { "value": "YYYY-MM-DDTHH:mm|YYYY-MM-DD|null", "quote": "string|null", "source": "string|null" },
  "term_from": { "value": "YYYY-MM-DD|null", "quote": "string|null", "source": "string|null" },
  "term_to":   { "value": "YYYY-MM-DD|null", "quote": "string|null", "source": "string|null" },
  "place": { "value": "string|null", "quote": "string|null", "source": "string|null" },
  "qual_category": { "value": "役務の提供等|物品の販売|物品の製造|null", "quote": "string|null", "source": "string|null" },
  "item":  { "value": "string|null", "quote": "string|null", "source": "string|null" },
  "grade": { "value": "string|null", "quote": "string|null", "source": "string|null" },
  "areas": { "value": ["string"], "quote": "string|null", "source": "string|null" },
  "budget": { "value": 0, "disclosed": true, "quote": "string|null", "source": "string|null" },
  "jv_allowed": { "value": true, "quote": "string|null", "source": "string|null" },
  "electronic_bidding": { "value": true, "quote": "string|null", "source": "string|null" },
  "unknown_fields": ["string"]
}`;

export const BASIC_INFO_INSTRUCTIONS = `この抽出で特に注意すること:

・期限は3種類あります。混同しないでください
  - submit_deadline: 入札書（または参加表明書）の提出期限
  - qa_deadline: 質問・照会の受付期限
  - bid_open_at: 開札の日時
  資料に「入札書受領期限」「入札締切」とあれば submit_deadline です。
  「質問書の提出期限」「照会期限」は qa_deadline です。

・時刻が書かれていない期限は、日付だけ（YYYY-MM-DD）で返してください。
  書かれていない時刻を補わないでください。原文に「令和８年９月10日（木）まで」としか
  なければ "2026-09-10" です。"2026-09-10T17:00" と書いてはいけません。
  「17時まで」「午後5時」のように時刻が書かれているときだけ、時刻を付けます
・「令和8年7月7日」は 2026-07-07 です

・item は全省庁統一資格の「営業品目」です。案件名ではありません。
  「調査・研究」「情報処理」「ソフトウェア開発」「建物管理等各種保守管理」「その他」
  のような、資格の登録区分として資料に書かれている語を入れてください。
  ふつうは競争参加資格の条件の中に「『役務の提供等』の『情報処理』の営業品目」の
  ように書かれています。
  資料に営業品目の記載が無ければ null にします。件名で代用しないでください
・予定価格が「非公表」「事後公表」の場合は disclosed: false、value: null にします
・等級は「B以上」「C又はD」など原文の表記のまま value に入れてください。正規化しません
・areas は「関東・甲信越」のような競争参加地域の区分です。履行場所とは別です
・単体企業に限る旨の記載があれば jv_allowed: false です。記載がなければ null`;
