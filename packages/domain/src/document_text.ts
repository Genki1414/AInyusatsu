// 資料のテキスト抽出（タスク2-2）で使う純ロジック。副作用を持たない。
// 参照：docs/実装仕様書_v1.md §4.1「テキストPDF：そのまま抽出。画像PDF：OCR」

/**
 * 1ページぶんの抽出テキストが、OCRを要する画像PDF（スキャン）かどうかを判定するしきい値。
 * 実際のテキストPDFのページは、ヘッダー・フッターだけでもこの文字数を大きく超える。
 * スキャンPDFはテキストレイヤーが無いため、抽出結果が空文字か、埋め込みメタデータ由来の
 * ごく短い文字列になる（実機未検証・要調整。docs/reference/参照）。
 */
const MIN_CHARS_PER_PAGE = 20;

/** 1ページぶんの抽出テキストから、OCRが必要か（＝画像PDFの可能性が高いか）を判定する。 */
export function needsOcr(pageText: string): boolean {
  const trimmed = pageText.replace(/\s+/g, "");
  return trimmed.length < MIN_CHARS_PER_PAGE;
}
