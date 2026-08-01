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

// 実データ確認済み（2026-08-01）：GEPSの検索フォームは物品だけ・役務だけを絞り込む手段が
// 無い（「分類」はradioで全て／物品・役務／簡易な公共事業の3択のみ）。そのため検索は
// 分類を指定せず1日1回だけ行い、案件ごとの分類はextractDetailFromCurrentPage()が
// 詳細画面から判定する。以前は物品・役務で2回検索していたが、実際には同じ結果を2回
// 取得するだけで、かつ2回の独立したブラウザセッション間で機関名抽出にわずかな差異が
// 出ると同じcodeで異なるdedupe_keyになりtenders_code_key制約違反を起こすことが実機で
// 判明したため、1日1回の巡回に修正した（jobs/crawl_geps.ts側もあわせて修正）。

// 実データ確認済み（2026-08-01、ユーザーがブラウザのソース表示で確認）。
// 設計時の想定（UZA01/OZA0101）ではなく、実際の検索画面はUAA01/OAA0101だった。
const SEARCH_URL = "https://www.p-portal.go.jp/pps-web-biz/UAA01/OAA0101";

export type GepsDocument = {
  kind: DocKind;
  portalCategory: string;
  filename: string;
  buffer: Buffer;
};

export type GepsSearchResult = {
  count: number;
  truncated: boolean;
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

/** 公開開始日=dateIso（1日分）で検索し、結果件数を返す（分類での絞り込みはできない。上記コメント参照）。 */
export async function searchByDate(page: Page, dateIso: string): Promise<GepsSearchResult> {
  await page.goto(SEARCH_URL);

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

  // 実データ確認済み（2026-08-01）：「公示本文」のリンクはhrefを持つ<a>ではなく、
  // javascript:doSubmitParams(...)でページ内フォーム送信するリンクだった。そのため
  // hrefを事前に取得してpage.goto()する方式（旧実装）は net::ERR_ABORTED になる。
  // 実際にクリックして遷移させる必要がある（openDetailByIndex参照）。
  const count = await page.getByRole("link", { name: "公示本文" }).count();

  return { count, truncated: isSearchTruncated(count) };
}

// --- 手順4：「公示本文」→ 調達情報の詳細 -----------------------------------

/**
 * 検索結果一覧のindex番目（0始まり）の「公示本文」をクリックして詳細画面へ遷移し、
 * 案件情報と「調達資料 ダウンロードURL」を取得する。呼び出し後、pageは詳細画面にいる
 * （一覧へは戻さない。javascript:doSubmitParams(...)によるページ内遷移のため、
 * hrefからのpage.goto()は使えない。呼び出し元は次の案件へ進む前に検索をやり直すこと）。
 */
export async function openDetailByIndex(
  page: Page,
  index: number,
): Promise<{ detail: GepsDetail; documentDownloadUrl: string | null; detailPageUrl: string }> {
  const link = page.getByRole("link", { name: "公示本文" }).nth(index);
  await Promise.all([page.waitForLoadState("networkidle"), link.click()]);
  const { detail, documentDownloadUrl } = await extractDetailFromCurrentPage(page);
  return { detail, documentDownloadUrl, detailPageUrl: page.url() };
}

/** 現在開いている詳細ページから、案件情報と「調達資料 ダウンロードURL」を取得する。 */
async function extractDetailFromCurrentPage(
  page: Page,
): Promise<{ detail: GepsDetail; documentDownloadUrl: string | null }> {
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

/** 1日分の巡回：検索→各案件の詳細取得→資料ダウンロードまでを行う（分類での絞り込みはできないため1日1回）。 */
export async function crawlDate(dateIso: string): Promise<GepsCrawlResult> {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();

    const search = await searchByDate(page, dateIso);
    const tenders: NormalizedGepsTender[] = [];
    const documentsByProcurementNo = new Map<string, GepsDocument[]>();

    for (let i = 0; i < search.count; i++) {
      // 詳細画面・資料DL画面への遷移で一覧のページ状態が失われるため、2件目以降は
      // 案件ごとに検索をやり直してから i 番目の「公示本文」をクリックする
      // （javascript:doSubmitParams(...)によるページ内遷移のため、ブラウザバックでの
      // 復元が確実とは限らない。実データ確認済み・2026-08-01）。
      if (i > 0) {
        await searchByDate(page, dateIso);
      }
      const { detail, documentDownloadUrl, detailPageUrl } = await openDetailByIndex(page, i);
      const normalized = normalizeGepsTender(detail, detailPageUrl);
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
