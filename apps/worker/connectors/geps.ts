// 調達ポータル（GEPS）コネクタ。Playwrightでの画面操作を伴う。
// 参照：docs/調達ポータルコネクタ設計.md §2-5（実機で確認した取得手順）
//
// 【重要・未検証】このファイルはPlaywrightで実際の画面を操作するが、本セッションの
// ネットワークポリシーで www.p-portal.go.jp に到達できないため、セレクタ（getByLabel/
// getByRole等）はdocs/調達ポータルコネクタ設計.md §2-5に記載された「確認済みの文言」
// （分類・公開開始日・検索・公示本文・調達資料 ダウンロードURL・連絡先情報をはじめから
// 入力する・商号又は名称／氏名／電話番号／メールアドレス・ダウンロード）を根拠に実装した。
// 実際のDOM構造（select/checkbox/radio、テーブル構造）までは確認できていないため、
// 実行して失敗した箇所があれば、該当のステップ関数だけを実データに合わせて修正すればよい
// ように、§2-5の手順1〜7に対応する関数へ分割している。
//
// 資料DLはICカード不要（「連絡先情報をはじめから入力する」経路）。収集端末は使わない
// （ユーザー指示）。連絡先4項目は環境変数で保持する。

import { chromium, type Page } from "playwright";
import AdmZip from "adm-zip";
import {
  classifyDocumentKind,
  isSearchTruncated,
  normalizeGepsTender,
  type DocKind,
  type GepsCategory,
  type GepsDetail,
  type NormalizedGepsTender,
} from "@ai-nyusatsu-bu/domain";

// 実データ確認済み（2026-08-01、ユーザーがブラウザのソース表示で確認）。
// 設計時の想定（UZA01/OZA0101）ではなく、実際の検索画面はUAA01/OAA0101だった。
const SEARCH_URL = "https://www.p-portal.go.jp/pps-web-biz/UAA01/OAA0101";

export type GepsDocument = {
  kind: DocKind;
  portalCategory: string;
  filename: string;
  buffer: Buffer;
};

export type GepsListRow = {
  procurementNo: string;
  detailUrl: string;
};

export type GepsSearchResult = {
  count: number;
  truncated: boolean;
  rows: GepsListRow[];
};

function contactInfo(): { company: string; name: string; tel: string; email: string } {
  const company = process.env.GEPS_CONTACT_COMPANY;
  const name = process.env.GEPS_CONTACT_NAME;
  const tel = process.env.GEPS_CONTACT_TEL;
  const email = process.env.GEPS_CONTACT_EMAIL;
  if (!company || !name || !tel || !email) {
    throw new Error(
      "GEPS_CONTACT_COMPANY / GEPS_CONTACT_NAME / GEPS_CONTACT_TEL / GEPS_CONTACT_EMAIL が" +
        "すべて設定されている必要があります（docs/調達ポータルコネクタ設計.md §2-5 手順6）",
    );
  }
  return { company, name, tel, email };
}

// --- 手順1・2：調達情報の検索（ログイン不要） -----------------------------

/** 公開開始日=dateIso（1日分）・分類=categoryで検索し、結果件数と各案件の詳細リンクを返す。 */
export async function searchByDate(
  page: Page,
  dateIso: string,
  category: GepsCategory,
): Promise<GepsSearchResult> {
  await page.goto(SEARCH_URL);

  // 実データ確認済み（2026-08-01）：「分類」はradioで「全て／物品・役務／簡易な公共事業」の
  // 3択のみ。物品だけ・役務だけを絞り込む手段は検索フォーム側には無い。そのため検索段階では
  // 絞り込まず（既定の「全て」のまま）、案件ごとの分類はfetchDetail()が詳細画面の「分類」欄から
  // 判定する（既存の実装のまま）。category引数は呼び出し元の記録用（documentsByProcurementNo等）
  // 以外では使わない。

  // 公開開始日（開始・終了とも同じ日を指定して1日ぶんに絞る）。
  // 実データ確認済み（2026-08-01）：ラベルは「公開開始日の自」「公開開始日の至」
  // （<label for="start-date-from">公開開始日の自</label> 等）。
  // 日付の入力フォーマットは YYYY/MM/DD（スラッシュ区切り）。dateIso（YYYY-MM-DD）から変換する。
  const slashDate = dateIso.replaceAll("-", "/");
  const dateFrom = page.getByLabel("公開開始日の自");
  const dateTo = page.getByLabel("公開開始日の至");
  await dateFrom.fill(slashDate);
  await dateTo.fill(slashDate);

  // 実データ確認済み（2026-08-01）：ページ上部のグローバルナビに「調達情報検索」「事業者検索」
  // という別ボタンがあり、name:"検索"の部分一致だと3件ヒットして曖昧になる（strict mode違反）。
  // 実際の検索実行ボタンは <input type="submit" value="検索 " id="OAA0102"> で、
  // 前後の空白を除けばアクセシブルネームが厳密に"検索"のみなので、exact:trueで一意にする。
  await page.getByRole("button", { name: "検索", exact: true }).click();
  await page.waitForLoadState("networkidle");

  const rows = await scrapeListRows(page);
  const count = rows.length;

  return { count, truncated: isSearchTruncated(count), rows };
}

/** 検索結果一覧（調達実施案件公示）から、調達案件番号と詳細リンクを抜き出す。 */
async function scrapeListRows(page: Page): Promise<GepsListRow[]> {
  const rows: GepsListRow[] = [];
  const links = await page.getByRole("link", { name: "公示本文" }).all();
  for (const link of links) {
    const href = await link.getAttribute("href");
    if (!href) continue;
    const row = link.locator("xpath=ancestor::tr[1]");
    const procurementNo = (await row.locator("td").first().innerText().catch(() => "")).trim();
    if (!procurementNo) continue;
    rows.push({ procurementNo, detailUrl: new URL(href, page.url()).toString() });
  }
  return rows;
}

// --- 手順4：「公示本文」→ 調達情報の詳細 -----------------------------------

/** 詳細ページから、案件情報と「調達資料 ダウンロードURL」を取得する。 */
export async function fetchDetail(
  page: Page,
  detailUrl: string,
): Promise<{ detail: GepsDetail; documentDownloadUrl: string | null }> {
  await page.goto(detailUrl);

  const text = async (label: string): Promise<string | null> => {
    const el = page.getByText(label).locator("xpath=following-sibling::*[1]");
    if (await el.count()) return (await el.first().innerText()).trim();
    return null;
  };

  const procurementNo = (await text("調達案件番号")) ?? "";
  const categoryRaw = (await text("分類")) ?? "役務";
  const category: GepsCategory = categoryRaw.includes("物品") ? "物品" : "役務";
  const name = (await text("調達案件名称")) ?? (await page.title());
  const publicFrom = await text("公開開始日");
  const agencyName = (await text("調達機関")) ?? "";
  const place = await text("所在地");

  // 「公告内容」が外部サイトへのリンクの場合がある（実例：高田河川国道事務所）
  let announcementUrl: string | null = null;
  const announcementLink = page.getByText("公告内容").locator("xpath=following::a[1]");
  if (await announcementLink.count()) {
    const href = await announcementLink.first().getAttribute("href");
    if (href && !href.includes("p-portal.go.jp")) {
      announcementUrl = new URL(href, page.url()).toString();
    }
  }

  const docLink = page.getByRole("link", { name: "調達資料 ダウンロードURL" });
  const documentDownloadUrl = (await docLink.count())
    ? new URL((await docLink.first().getAttribute("href")) ?? "", page.url()).toString()
    : null;

  const detail: GepsDetail = {
    procurementNo,
    category,
    name,
    publicFrom,
    agencyName,
    place,
    announcementUrl,
  };

  return { detail, documentDownloadUrl };
}

// --- 手順5〜7：資料一式のダウンロード（ICカード不要・連絡先入力方式） -----

/**
 * 「調達資料 ダウンロードURL」から資料一式（zip）を取得し、資料種別ごとに分類する。
 * 「連絡先情報をはじめから入力する」を選び、ICカードを使わない経路のみを通す。
 */
export async function downloadDocuments(page: Page, documentDownloadUrl: string): Promise<GepsDocument[]> {
  await page.goto(documentDownloadUrl);

  // 連絡先情報入力方法選択：「連絡先情報をはじめから入力する」（ICカード不要の経路）
  await page.getByRole("link", { name: "連絡先情報をはじめから入力する" })
    .or(page.getByRole("button", { name: "連絡先情報をはじめから入力する" }))
    .click();

  // 利用者情報入力（4項目・すべて必須）
  const contact = contactInfo();
  await page.getByLabel("商号又は名称").fill(contact.company);
  await page.getByLabel("氏名").fill(contact.name);
  await page.getByLabel("電話番号").fill(contact.tel);
  await page.getByLabel("メールアドレス").fill(contact.email);

  // 添付資料一覧が表示される。項番・資料種別・ファイル名を先に読み取っておく。
  const portalCategories = await scrapeDocumentCategories(page);

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "ダウンロード" }).click();
  const download = await downloadPromise;
  const path = await download.path();
  if (!path) {
    throw new Error("調達資料のダウンロードに失敗しました（一時ファイルが取得できません）");
  }

  const zip = new AdmZip(path);
  const documents: GepsDocument[] = [];
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    const filename = entry.entryName.split("/").pop() ?? entry.entryName;
    const portalCategory = portalCategories.get(filename) ?? "その他";
    documents.push({
      kind: classifyDocumentKind(portalCategory, filename),
      portalCategory,
      filename,
      buffer: entry.getData(),
    });
  }
  return documents;
}

/** 添付資料一覧（項番・資料種別・ファイル名・ファイルサイズ）からファイル名→資料種別の対応を作る。 */
async function scrapeDocumentCategories(page: Page): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const rows = await page.getByRole("row").all();
  for (const row of rows) {
    const cells = await row.locator("td").allInnerTexts();
    if (cells.length < 3) continue;
    const [, portalCategory, filename] = cells;
    if (filename) map.set(filename.trim(), (portalCategory ?? "").trim());
  }
  return map;
}

// --- コネクタ本体 -----------------------------------------------------------

export type GepsCrawlResult = {
  tenders: NormalizedGepsTender[];
  documentsByProcurementNo: Map<string, GepsDocument[]>;
  truncated: boolean;
  count: number;
};

/** 1日分・1分類ぶんの巡回：検索→各案件の詳細取得→資料ダウンロードまでを行う。 */
export async function crawlDate(dateIso: string, category: GepsCategory): Promise<GepsCrawlResult> {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();

    const search = await searchByDate(page, dateIso, category);
    const tenders: NormalizedGepsTender[] = [];
    const documentsByProcurementNo = new Map<string, GepsDocument[]>();

    for (const row of search.rows) {
      const { detail, documentDownloadUrl } = await fetchDetail(page, row.detailUrl);
      const normalized = normalizeGepsTender(detail, row.detailUrl);
      tenders.push(normalized);

      if (documentDownloadUrl) {
        try {
          const docs = await downloadDocuments(page, documentDownloadUrl);
          documentsByProcurementNo.set(normalized.procurementNo, docs);
        } catch (err) {
          // 資料が取れない案件があっても、案件自体の投入は止めない（資料取得方針_v3.md）。
          // 失敗理由はジョブ側でtender_documentsのfailure相当として扱う。
          documentsByProcurementNo.set(normalized.procurementNo, []);
          // eslint-disable-next-line no-console
          console.error(`資料ダウンロード失敗: ${normalized.procurementNo}`, err);
        }
      }
    }

    return { tenders, documentsByProcurementNo, truncated: search.truncated, count: search.count };
  } finally {
    await browser.close();
  }
}
