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

/**
 * Cookie同意バナー（「同意する」ボタン、id="c-p-bn"）が表示されていれば閉じる。
 * 実機確認済み（2026-08-01）：資料DL先（geps.go.jp/biz-contract配下）ではこのバナーが
 * 「次へ」ボタンの上に重なり、クリックを妨げる（"subtree intercepts pointer events"）。
 * 出ていない場合も多いため、存在チェックしてから閉じる（無ければ何もしない）。
 */
async function dismissCookieConsent(page: Page): Promise<void> {
  const consentButton = page.getByRole("button", { name: "同意する" });
  if (await consentButton.count()) {
    await consentButton.click({ force: true }).catch(() => {});
  }
}

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
  // 実データ確認済み（2026-08-01）：waitForLoadState("networkidle")は「今のページが
  // アイドル状態になるまで待つ」だけで、クリックが引き起こす遷移そのものとは紐付いて
  // いないため、遷移が始まる前にresolveしてしまう競合が高頻度（実測5割超）で発生した
  // （詳細画面がまだ"Loading..."や検索結果画面のままの状態で読み取りを始めていた）。
  // detail画面のURL（/OAA0104）への遷移を明示的に待ってから読み取る。
  const link = page.getByRole("link", { name: "公示本文" }).nth(index);
  await Promise.all([page.waitForURL(/OAA0104/), link.click()]);
  await page.waitForLoadState("networkidle");
  const { detail, documentDownloadUrl } = await extractDetailFromCurrentPage(page);
  return { detail, documentDownloadUrl, detailPageUrl: page.url() };
}

/** 現在開いている詳細ページから、案件情報と「調達資料 ダウンロードURL」を取得する。 */
async function extractDetailFromCurrentPage(
  page: Page,
): Promise<{ detail: GepsDetail; documentDownloadUrl: string | null }> {
  // 実データ確認済み（2026-08-01）：各項目は <tr><th>ラベル</th><td>値</td></tr> という
  // 表構造。以前の実装（getByText(ラベル)の次の兄弟要素を値とみなす）は、getByTextが
  // 部分一致でラベル以外の要素にもマッチしうるため、隣の項目のラベル文字列を値として
  // 誤って取得することがあった（実機で確認：「調達案件番号」の値が次の項目のラベル
  // 「調達機関」になっていた）。th要素との完全一致＋直後のtd兄弟要素に絞ることで防ぐ。
  const text = async (label: string): Promise<string | null> => {
    const cell = page.locator(`th:text-is("${label}") + td`).first();
    if (await cell.count()) return (await cell.innerText()).trim();
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
  const announcementLink = page.locator('th:text-is("公告内容") + td a').first();
  if (await announcementLink.count()) {
    const href = await announcementLink.getAttribute("href");
    if (href && !href.includes("p-portal.go.jp")) {
      announcementUrl = new URL(href, page.url()).toString();
    }
  }

  // 実データ確認済み（2026-08-01）：実際のリンク文言は「調達資料１ダウンロードURL」
  // （間に空白が無く、全角数字。資料は1〜5まで番号ごとに個別のリンクになりうる）で、
  // 想定していた「調達資料 ダウンロードURL」（半角スペース区切り・単一）とは異なっていた。
  // 【重要】番号は全角数字（１２３…）。正規表現の\dは半角数字にしかマッチしないため、
  // 全角数字（０-９）も明示的に含める（実機で\dのみだと1件もマッチしなかった）。
  // 【現状の制約】1件目（番号が最小のもの）だけを取得する。複数資料（調達資料1〜5）を
  // すべて取得する対応は未実装（docs/reference/調達ポータル_巡回_確認事項.md参照）。
  const docLink = page.getByRole("link", { name: /^調達資料[0-9０-９]+ダウンロードURL/ }).first();
  const documentDownloadUrl = (await docLink.count())
    ? new URL((await docLink.getAttribute("href")) ?? "", page.url()).toString()
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
  await dismissCookieConsent(page);

  // 連絡先情報入力方法選択：実データ確認済み（2026-08-01）、リンクやボタンではなくradio
  // （「電子調達システムに登録している連絡先情報を利用する」と「連絡先情報をはじめから
  // 入力する」の2択。既定では前者が選択されている）。後者を選んでから「次へ」で進む。
  // 実機確認済み：このradio自体は見た目のUI（スタイル付きの別要素）とは別に画面外へ
  // 配置されており、force:trueでも"Element is outside of the viewport"で失敗する。
  // クリック操作を模倣せず、DOM要素のcheckedプロパティを直接操作してchange/clickイベントを
  // 発火させる（見た目や座標に依存しないため、この種の隠しinputパターンに対して確実）。
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await page.getByRole("radio", { name: "連絡先情報をはじめから入力する" }).evaluate((el: any) => {
    el.checked = true;
    el.dispatchEvent(new Event("click", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
  // 実機確認済み：Cookie同意バナー（「同意する」）を閉じてもなお、画面下部固定の
  // 「この画面の先頭へ」ボタンがスクロール位置によって「次へ」に重なりクリックを
  // 妨げることがあった（"subtree intercepts pointer events"）。force:trueで、
  // 座標上の重なりチェックを省略して直接クリックする。
  await page.getByRole("button", { name: "次へ", exact: true }).click({ force: true });
  // 実機確認済み：クリック直後は次の画面の読み込みが終わっていないことがあり、
  // 詳細画面の遷移待ちと同様の競合でth:text-is(...)が見つからずタイムアウトすることが
  // あった。読み込み完了を待ってから入力欄を探す。
  await page.waitForLoadState("networkidle");

  // 利用者情報入力（4項目・すべて必須）。実機確認済み（2026-08-03）：詳細画面と同様、
  // ここも<label for>ではなく<tr><th>ラベル</th><td><input></td></tr>という表構造
  // だったため、getByLabel()では見つからずタイムアウトしていた。thとの完全一致＋
  // 直後のtd内のinputを直接指定する。
  const contact = contactInfo();
  const fillByLabel = async (label: string, value: string) => {
    await page.locator(`th:text-is("${label}") + td input`).first().fill(value);
  };
  await fillByLabel("商号又は名称", contact.company);
  await fillByLabel("氏名", contact.name);
  await fillByLabel("電話番号", contact.tel);
  await fillByLabel("メールアドレス", contact.email);

  // 実機確認済み（2026-08-02、ユーザーのスクリーンショットで確認）：利用者情報入力の
  // 「次へ」を押しても資料一覧画面には進まず、入力内容をそのまま表示する
  // 「利用者情報確認」という中間画面がもう1つある。そこでも「次へ」を押して、
  // ようやく資料一覧とダウンロードボタンのある「調達資料一式ダウンロード」画面に
  // たどり着く。連絡先入力直後にダウンロードボタンを探しに行く実装では、この
  // 確認画面を素通りできずタイムアウトしていた（2段階の「次へ」が必要）。
  await page.getByRole("button", { name: "次へ", exact: true }).click({ force: true });
  await page.waitForLoadState("networkidle");

  // 利用者情報確認画面。表示された内容を確認し、再度「次へ」を押す。
  await page.getByRole("button", { name: "次へ", exact: true }).click({ force: true });
  // 実機確認済み（2026-08-03）：この先の資料一覧画面は、添付資料が多い案件だと
  // アイコン等の読み込みが続き、waitForLoadState("networkidle")の30秒以内に
  // ネットワークが完全に静止せずタイムアウトすることがあった（実際の画面遷移自体は
  // 完了していた）。無関係な通信の有無に左右されないよう、実際に必要な
  // 「ダウンロード」ボタンの表示を直接待つ方式に変更した。
  await page.getByRole("button", { name: "ダウンロード" }).waitFor({ state: "visible", timeout: 45000 });

  // 添付資料一覧が表示される。項番・資料種別・ファイル名を先に読み取っておく。
  const portalCategories = await scrapeDocumentCategories(page);

  // クリックが失敗した場合にwaitForEvent("download")のPromiseが宙に浮いたまま
  // 後で拾い手のない例外（unhandled rejection）としてプロセスごと落ちることがあった
  // （実機確認済み）。Promise.allで両方を確実に結びつけて後始末する。
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "ダウンロード" }).click(),
  ]);
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
