// 落札実績オープンデータ（調達ポータル）のダウンロード＋zip展開。
// 参照：docs/落札実績オープンデータ_取り込み設計.md、docs/reference/落札実績オープンデータ_列定義（推定）.md
//
// ファイル名の規則（ユーザー確認済み）：
//   全件: successful_bid_record_info_all_{西暦}.zip（年ごと）
//   差分: successful_bid_record_info_diff_{YYYYMMDD}.zip（日ごと・過去2か月分のみ存在）
//
// ダウンロードURLの形式（ユーザーがブラウザの開発者ツールで確認済み。2026-08-01）：
//   ダウンロードページ（https://www.p-portal.go.jp/pps-web-biz/UAB02/OAB0201）の
//   ダウンロードリンクは静的なURLではなく、doDownload(fileName)というJS関数で
//   `uab02FileDownloadUrl + fileName` へ遷移する形になっている。
//   uab02FileDownloadUrlの実際の値は
//     https://api.p-portal.go.jp/pps-web-biz/UAB03/OAB0301?fileversion=v001&filename=
//   （www.ではなくapi.サブドメイン。パスではなくfilenameクエリパラメータの末尾に
//   ファイル名を連結する）。固定の公開エンドポイントのため既定値としてコードに持たせ、
//   環境変数 AWARDS_OPEN_DATA_BASE_URL は変更したい場合のみの上書き用とする。

import AdmZip from "adm-zip";

const BASE_URL_ENV = "AWARDS_OPEN_DATA_BASE_URL";
const DEFAULT_BASE_URL = "https://api.p-portal.go.jp/pps-web-biz/UAB03/OAB0301?fileversion=v001&filename=";

function baseUrl(): string {
  return process.env[BASE_URL_ENV] || DEFAULT_BASE_URL;
}

function fullDataFileName(year: number): string {
  return `successful_bid_record_info_all_${year}.zip`;
}

function diffDataFileName(date: Date): string {
  return `successful_bid_record_info_diff_${formatYYYYMMDD(date)}.zip`;
}

function formatYYYYMMDD(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

async function downloadZip(
  url: string,
): Promise<{ ok: true; buffer: Buffer } | { ok: false; status: number }> {
  const res = await fetch(url);
  // 差分データは過去2か月分しか存在しない。存在しない日は404が正常系。
  if (res.status === 404) return { ok: false, status: 404 };
  if (!res.ok) {
    throw new Error(`落札実績オープンデータのダウンロードに失敗しました: ${url} (HTTP ${res.status})`);
  }
  const arrayBuffer = await res.arrayBuffer();
  return { ok: true, buffer: Buffer.from(arrayBuffer) };
}

function extractFirstCsv(buffer: Buffer, sourceLabel: string): { fileName: string; text: string } {
  const zip = new AdmZip(buffer);
  const entry = zip.getEntries().find((e) => !e.isDirectory && e.entryName.toLowerCase().endsWith(".csv"));
  if (!entry) {
    throw new Error(`${sourceLabel} のzip内にCSVファイルが見つかりません`);
  }
  // ユーザー確認済み：CSVはUTF-8（BOM付き）。BOM除去はdomain側のparseAwardsCsvで行う。
  return { fileName: entry.entryName, text: entry.getData().toString("utf-8") };
}

export type FetchResult =
  | { found: true; csvFileName: string; sourceFile: string; text: string }
  | { found: false; sourceFile: string };

/** 全件データ（年度ごと）を取得する。 */
export async function fetchFullData(year: number): Promise<FetchResult> {
  const sourceFile = fullDataFileName(year);
  const res = await downloadZip(`${baseUrl()}${encodeURIComponent(sourceFile)}`);
  if (!res.ok) return { found: false, sourceFile };
  const { fileName, text } = extractFirstCsv(res.buffer, sourceFile);
  return { found: true, csvFileName: fileName, sourceFile, text };
}

/**
 * 差分データ（日ごと）を取得する。
 * 対象日のファイルが存在しない（404）場合は found:false を返す（エラーではなく正常系）。
 */
export async function fetchDiffData(date: Date): Promise<FetchResult> {
  const sourceFile = diffDataFileName(date);
  const res = await downloadZip(`${baseUrl()}${encodeURIComponent(sourceFile)}`);
  if (!res.ok) return { found: false, sourceFile };
  const { fileName, text } = extractFirstCsv(res.buffer, sourceFile);
  return { found: true, csvFileName: fileName, sourceFile, text };
}

// テスト・デバッグ用に内部関数を公開する。
export const _internal = { fullDataFileName, diffDataFileName, formatYYYYMMDD };
