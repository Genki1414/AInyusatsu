// AI解析プロンプト集.md §5「注意事項の抽出」。追加の指示の本文はそのまま使う（書き換えない）。

export const NOTES_SCHEMA_DESCRIPTION = `{
  "notes": [
    { "text": "string", "importance": "critical|normal",
      "reason": "失格|コスト|工程|その他",
      "quote": "string", "source": "string" }
  ],
  "unknown_reason": "string|null"
}`;

export const NOTES_INSTRUCTIONS = `・優先して拾う表現
  「〜に限る」「〜を除く」「〜は落札者の負担とする」「〜しなければ失格とする」
  「〜の提出をもって」「事前に〜が必要」「〜時間内に限る」「〜を有する者に限る」

・importance: critical にするもの
  - 満たさないと失格・無効になるもの
  - 落札者の費用負担が発生するもの（処分費、原状回復、保険）
  - 作業時間・立入手続の制限（コストに直結）

・拾わないもの
  - 一般的な契約手続の説明
  - 法令の条文をそのまま引いただけの記述
  - 他の項目（参加資格・提出書類）で既に抽出しているもの

・最大10件。多い場合は importance: critical を優先します`;
