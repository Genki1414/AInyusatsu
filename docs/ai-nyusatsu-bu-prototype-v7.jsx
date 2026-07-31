import React, { useMemo, useState } from "react";
import {
  Bot, Search, Users, Radar, CheckCircle2, AlertTriangle, Inbox, ChevronRight,
  FileText, Mail, MessageSquare, X, Send, ListChecks, Sparkles, Lock,
  RefreshCw, Phone, Star, Database, Server, Printer, Download, Target,
  AlertOctagon, HelpCircle, Calculator, ClipboardCheck, Award,
  BadgeCheck, Circle, ArrowRight, Home, Compass, Store
} from "lucide-react";

/* =============================================================================
   AI入札部 / プロトタイプ v3
   プロダクト方針：入札の素人でも、公共調達に参加して提出まで完走できること。
   そのために「画面を並べる」のではなく「案件ごとの手順（進め方ガイド）」を
   中心に据え、各ステップで AIがやったこと / あなたがやること を明示する。

   責務分離（本実装時のモジュール）
     connectors/ crawler/ documents/ parser/ db/ proposal/ notification/
     quotes/（見積依頼・回収・比較） costing/（原価集計・応札価格の検討）
     forms/（提出書類） qa/（質問書） awards/（落札結果・相場）
   本ファイルは ui/ 相当。データは SEED_* に閉じ、判定は純関数に切り出す。
============================================================================= */

/* ── 定数 ─────────────────────────────────────────────────────────────────── */
const COLLECT = ["未取得", "取得中", "取得済", "AI解析中", "解析完了", "公開中", "終了"];
const PROPOSE = ["提案対象", "配信済", "既読", "検討中", "対象外"];
const WORK = ["募集開始", "見積依頼中", "見積回収中", "積算中", "提出済", "落札", "施工中", "完工"];
const OFFICIAL = ["未取得", "申請中", "取得済"];

const COLLECT_STYLE = {
  未取得: "bg-slate-100 text-slate-600 border-slate-300", 取得中: "bg-blue-50 text-blue-800 border-blue-200",
  取得済: "bg-blue-50 text-blue-800 border-blue-200", AI解析中: "bg-violet-50 text-violet-800 border-violet-200",
  解析完了: "bg-violet-50 text-violet-800 border-violet-200", 公開中: "bg-emerald-50 text-emerald-800 border-emerald-300",
  終了: "bg-slate-50 text-slate-400 border-slate-200",
};
const PROPOSE_STYLE = {
  提案対象: "bg-blue-50 text-blue-800 border-blue-200", 配信済: "bg-emerald-50 text-emerald-800 border-emerald-300",
  既読: "bg-slate-100 text-slate-700 border-slate-300", 検討中: "bg-amber-50 text-amber-800 border-amber-200",
  対象外: "bg-slate-50 text-slate-400 border-slate-200",
};
const WORK_STYLE = {
  募集開始: "bg-slate-100 text-slate-700 border-slate-300", 見積依頼中: "bg-blue-50 text-blue-800 border-blue-200",
  見積回収中: "bg-amber-50 text-amber-800 border-amber-200", 積算中: "bg-violet-50 text-violet-800 border-violet-200",
  提出済: "bg-slate-800 text-white border-slate-800", 落札: "bg-emerald-50 text-emerald-800 border-emerald-300",
  施工中: "bg-teal-50 text-teal-800 border-teal-200", 完工: "bg-slate-50 text-slate-500 border-slate-200",
};

/* 素人向け：専門用語のやさしい説明（?にカーソルで表示） */
const TERMS = {
  一般競争入札: "参加資格を満たす会社なら誰でも参加でき、一番安い価格を出した会社が受注する方式。公共調達の基本形です。",
  全省庁統一資格: "国の省庁の物品・役務の入札に参加するための共通の資格。一度取れば各省庁で使えます。有効期間は3年度単位。",
  営業品目: "資格申請のときに「うちはこれをやります」と登録した business の種類。登録していない品目の入札には参加できません。",
  等級: "会社の規模や実績で決まるランク（A〜D）。案件ごとに「B以上」のように必要な等級が決まっています。",
  競争参加地域: "資格上、入札に参加できる地域の区分（関東・甲信越など）。",
  予定価格: "発注機関が事前に決めている上限価格。これを超えると失格になります。公表される場合と非公表の場合があります。",
  開札: "提出された入札書を開いて、落札者を決める日。ここで結果が出ます。",
  落札率: "落札額 ÷ 予定価格。同種案件の落札率が分かると、いくらで出せば勝てるかの目安になります。",
  質問期限: "公告の内容で分からないことを発注機関に聞ける締切。過ぎると聞けません。",
  入札説明書: "参加条件・提出書類・手続きが書かれた書類。参加するなら必ず自社名義で取得します。",
  数量表: "何をどれだけやるかの一覧。協力会社に見積を頼むときの元になります。",
  内訳書: "入札価格の内訳を示す書類。提出を求められることが多く、様式が指定されます。",
};

const yen = (n) => (n == null ? "非公表" : "¥" + Math.round(n).toLocaleString("ja-JP"));
const man = (n) => (n == null ? "非公表" : Math.round(n / 10000).toLocaleString("ja-JP") + "万");
const GRADE_ORDER = { A: 4, B: 3, C: 2, D: 1 };
const TODAY = new Date(2026, 6, 30);
const daysLeft = (s) => {
  const m = /(\d{4})\/(\d{2})\/(\d{2})/.exec(s || "");
  return m ? Math.round((new Date(+m[1], +m[2] - 1, +m[3]) - TODAY) / 86400000) : 0;
};

/* ── 自社プロフィール ─────────────────────────────────────────────────────── */
/* 社内ユーザー（プランで人数上限が決まる） */
const USERS = [
  { id: "U1", name: "山田 太郎", role: "管理者", mail: "yamada@example.co.jp", last: "たった今" },
  { id: "U2", name: "佐藤 花子", role: "担当者", mail: "sato@example.co.jp", last: "07/29 17:40" },
];
const PLAN = { name: "スタンダード", seats: 2, criteriaSets: 2, support: "メール" };

const COMPANY = {
  name: "東葉総合サービス（株）",
  quals: ["役務の提供等", "物品の販売"],
  grades: { "役務の提供等": "B", "物品の販売": "C" },
  qualValidTo: "2028/03/31",
  items: ["建物管理等", "清掃", "警備", "植栽等管理", "什器類"],
  areas: ["関東・甲信越"],
  min: 3000000, max: 200000000, minDays: 5,
  keywords: ["清掃", "警備", "建物管理", "什器"],
  ngWords: ["情報処理", "システム開発"],
  ngAgencies: [],
  partnerTrades: ["清掃", "警備", "設備保守", "貯水槽清掃", "害虫防除", "廃棄物処理", "植栽", "什器納入", "電気"],
  excludes: ["JV必須の案件", "履行期間が3年を超える案件"],
  overhead: 0.12,   // 一般管理費率
  profit: 0.10,     // 目標利益率
};

/* ── 連絡チャネル（オンボーディングの判定に使う） ───────────────────────── */
const CHANNELS = { mail: true, line: false, mailAddress: "nyusatsu@example.co.jp", lineNote: "LINE公式アカウントの連携が未設定です" };

/* 初期設定の進み具合（素人が最初に触る導線） */
function setupSteps(tenders, quotes) {
  const considered = tenders.some((t) => t.proposal?.state === "検討中");
  const requested = quotes.length > 0;
  return [
    { k: "profile", label: "会社情報を登録する", why: "見積依頼の差出人や書類の会社名に使います。", done: true, go: "qual",
      detail: `${COMPANY.name}／登録済み` },
    { k: "qual", label: "入札資格を確認する", why: "資格がないと入札に参加できません。等級と営業品目で参加できる案件が決まります。", done: COMPANY.quals.length > 0, go: "qual",
      detail: `${COMPANY.quals.join("・")}／有効期限 ${COMPANY.qualValidTo}` },
    { k: "criteria", label: "ほしい案件の条件を決める", why: "この条件で毎朝の案件が絞り込まれます。あとから何度でも変えられます。", done: COMPANY.items.length > 0, go: "conditions",
      detail: `営業品目 ${COMPANY.items.length}件／${COMPANY.areas.join("・")}` },
    { k: "partners", label: "協力会社を登録する", why: "見積を頼む相手です。1業種1社からでも始められます。", done: PARTNERS.length >= 3, go: "partners",
      detail: `${PARTNERS.length}社（${[...new Set(PARTNERS.flatMap((p) => p.trades))].length}業種）` },
    { k: "channels", label: "見積の送受信をつなぐ", why: "LINEをつなぐと返信の自動取り込みが使えます。メールだけでも動きます。", done: CHANNELS.mail && CHANNELS.line, go: "partners",
      detail: CHANNELS.line ? "メール・LINE 連携済み" : "メールのみ連携済み（LINEは未設定）" },
    { k: "first", label: "最初の案件を進めてみる", why: "1件でも提出まで通すと、次からは同じ手順の繰り返しになります。", done: considered && requested, go: "proposals",
      detail: considered ? (requested ? "見積依頼まで到達" : "参加を検討中") : "まだ着手していません" },
  ];
}

/* ── コネクタ ─────────────────────────────────────────────────────────────── */
const CONNECTORS = [
  { id: "kkj", name: "官公需情報ポータルAPI", kind: "公式API", target: "国・独法・自治体の公告（横断）", state: "稼働中", last: "07/30 04:00", found: 47, docs: 0, fail: 0, note: "中小企業庁の公式API。案件の発見に使用。公告本文は取得できるが、入札説明書・仕様書・数量表・様式は含まれない" },
  { id: "geps", name: "調達ポータル（政府電子調達）", kind: "電子調達システム", target: "各府省の物品・役務", state: "稼働中", last: "07/30 04:02", found: 11, docs: 34, fail: 1, note: "当日ぶんの補完と資料取得。匿名で取れない資料は収集端末へ回す" },
  { id: "agency", name: "各府省サイト（企画競争・公募）", kind: "発注官庁の個別サイト", target: "調達ポータル対象外の公示", state: "稼働中", last: "07/30 04:11", found: 5, docs: 18, fail: 0, note: "機関追加は定義ファイルの追加のみ" },
  { id: "dokuho", name: "独立行政法人・特殊法人サイト", kind: "公開Webページ", target: "所管法人の調達情報", state: "稼働中", last: "07/30 04:18", found: 2, docs: 6, fail: 0, note: "法人ごとに掲載場所が違うため機関マスタで管理" },
  { id: "pdf", name: "公開PDF取得＋OCR", kind: "公開PDF", target: "公告・仕様書・数量表", state: "稼働中", last: "07/30 04:31", found: 0, docs: 24, fail: 1, note: "数量表はCSVへ正規化して見積依頼に流用" },
  { id: "mail", name: "メール交付（入札受信箱）", kind: "メール交付", target: "交付メールの添付", state: "稼働中", last: "07/30 04:35", found: 1, docs: 3, fail: 0, note: "" },
  { id: "fax", name: "FAX交付", kind: "FAX交付", target: "FAX申込の案件", state: "手動", last: "—", found: 0, docs: 0, fail: 0, note: "初期版は管理者が手動登録" },
];

/* ── 協力会社 ─────────────────────────────────────────────────────────────── */
const PARTNERS = [
  { id: "P01", name: "都心ビルサービス", person: "桜井 健一", base: "千代田区", trades: ["清掃"], areas: ["東京", "千葉"], mail: 1, line: 1, tel: "03-****-1122", quotes: 41, adopt: 0.46, resp: 2.6, rating: 4.6, memo: "官公庁の日常清掃に実績多数" },
  { id: "P02", name: "関東クリーンメンテ", person: "村田 誠", base: "船橋市", trades: ["清掃", "貯水槽清掃"], areas: ["千葉", "東京"], mail: 1, line: 0, tel: "047-***-8890", quotes: 27, adopt: 0.26, resp: 9.8, rating: 3.9, memo: "回答は遅いが単価は安い" },
  { id: "P03", name: "東京ガードシステム", person: "石井 亮", base: "港区", trades: ["警備"], areas: ["東京", "神奈川"], mail: 1, line: 1, tel: "03-****-3311", quotes: 19, adopt: 0.37, resp: 4.2, rating: 4.2, memo: "機械警備・常駐とも対応可" },
  { id: "P04", name: "関東セキュリティ", person: "大谷 一馬", base: "さいたま市", trades: ["警備"], areas: ["埼玉", "東京"], mail: 1, line: 0, tel: "048-***-4455", quotes: 14, adopt: 0.21, resp: 12.4, rating: 3.6, memo: "" },
  { id: "P05", name: "首都圏設備管理", person: "森 里美", base: "江東区", trades: ["設備保守", "電気"], areas: ["東京", "千葉"], mail: 1, line: 1, tel: "03-****-2200", quotes: 33, adopt: 0.48, resp: 2.1, rating: 4.7, memo: "法定点検に強く回答が最速" },
  { id: "P06", name: "東洋ビルテック", person: "新井 卓", base: "横浜市", trades: ["設備保守"], areas: ["神奈川", "東京"], mail: 1, line: 0, tel: "045-***-7788", quotes: 12, adopt: 0.25, resp: 7.4, rating: 3.8, memo: "" },
  { id: "P07", name: "クリーンペスト東京", person: "菅野 直樹", base: "足立区", trades: ["害虫防除", "貯水槽清掃"], areas: ["東京", "埼玉"], mail: 1, line: 1, tel: "03-****-6611", quotes: 22, adopt: 0.41, resp: 3.4, rating: 4.4, memo: "" },
  { id: "P08", name: "城南環境サービス", person: "大場 修", base: "品川区", trades: ["廃棄物処理"], areas: ["東京"], mail: 0, line: 1, tel: "03-****-9900", quotes: 16, adopt: 0.44, resp: 5.1, rating: 4.1, memo: "産廃許可・マニフェスト対応" },
  { id: "P09", name: "緑友園", person: "堀 政人", base: "市川市", trades: ["植栽"], areas: ["千葉", "東京"], mail: 1, line: 0, tel: "047-***-1717", quotes: 11, adopt: 0.36, resp: 6.9, rating: 4.0, memo: "" },
  { id: "P10", name: "オフィスサプライ東京", person: "岡島 剛", base: "台東区", trades: ["什器納入"], areas: ["東京", "千葉", "埼玉"], mail: 1, line: 1, tel: "03-****-5533", quotes: 25, adopt: 0.40, resp: 3.1, rating: 4.3, memo: "官公庁向けの納品書式に慣れている" },
  { id: "P11", name: "丸和商会", person: "西野 康", base: "中央区", trades: ["什器納入"], areas: ["東京"], mail: 1, line: 0, tel: "03-****-2929", quotes: 8, adopt: 0.25, resp: 8.7, rating: 3.7, memo: "" },
];
const partnerById = (id) => PARTNERS.find((p) => p.id === id) || { name: "—", person: "—", base: "", adopt: 0, resp: 0, line: 0 };

/* ── 落札結果（相場データ） ───────────────────────────────────────────────── */
const AWARDS = [
  { id: "W1", item: "建物管理等", name: "〇〇税務署 庁舎清掃業務", agency: "関東財務局", budget: 9200000, amount: 8740000, winner: "自社", date: "2026/07/22" },
  { id: "W2", item: "建物管理等", name: "△△合同庁舎 清掃業務", agency: "関東地方整備局", budget: 31500000, amount: 27400000, winner: "他社", date: "2026/06/18" },
  { id: "W3", item: "建物管理等", name: "□□官署 建物管理業務", agency: "気象庁", budget: 18700000, amount: 16800000, winner: "他社", date: "2026/05/27" },
  { id: "W4", item: "警備", name: "◇◇庁舎 機械警備業務", agency: "国土交通省", budget: 12400000, amount: 10900000, winner: "他社", date: "2026/06/03" },
  { id: "W5", item: "警備", name: "〇〇研究所 常駐警備業務", agency: "文部科学省", budget: 24800000, amount: 22600000, winner: "他社", date: "2026/04/22" },
  { id: "W6", item: "什器類", name: "△△局 事務用什器の購入", agency: "林野庁", budget: 7400000, amount: 6290000, winner: "他社", date: "2026/05/14" },
];
const marketRate = (item) => {
  const a = AWARDS.filter((x) => x.item === item);
  if (!a.length) return null;
  const r = a.reduce((n, x) => n + x.amount / x.budget, 0) / a.length;
  return { rate: r, n: a.length };
};

/* ── 共通案件マスタ ───────────────────────────────────────────────────────── */
/* got:1=取得済 / absent:true=機関が出していない（正常） / どちらでもない=取得できていない（要対応） */
const d = (kind, got, at, src, absent = false) => ({ kind, got, at, src, absent });
const form = (name, source, state, note) => ({ name, source, state, note });

const SEED_TENDERS = [
  {
    id: "T-2026-000842", dedupe: "MOF-KANTO/2026-0731-014/2026-08-07",
    name: "東京第3合同庁舎 建物清掃業務（単年度）", agency: "関東財務局", org: "東京財務事務所 総務課", noticeNo: "2026-0731-014",
    kind: "役務", qualCat: "役務の提供等", item: "建物管理等", grade: "B以上", areas: ["関東・甲信越"],
    noticeDate: "2026/07/24", submitDeadline: "2026/08/07 15:00", qaDeadline: "2026/08/01 17:00", bidOpen: "2026/08/19 10:30",
    place: "東京都千代田区霞が関3-1-1", termFrom: "2026/10/01", termTo: "2027/09/30", budget: 34800000,
    url: "https://www.example-mof.go.jp/nyusatsu/2026-0731-014.html", via: "電子調達システム", connector: "geps",
    fetchedAt: "07/30 04:02", updatedAt: "07/30 05:41", collect: "公開中", failure: null, parse: "完了",
    proposal: { state: "検討中", at: "07/30 05:47", reason: null },
    docs: [d("公告", 1, "07/30 04:03", "公告.pdf"), d("入札説明書", 1, "07/30 04:04", "入札説明書.pdf"), d("仕様書", 1, "07/30 04:05", "仕様書.pdf"), d("数量表", 1, "07/30 04:06", "数量表.xlsx"), d("様式", 1, "07/30 04:06", "様式一式.zip")],
    official: { state: "取得済", how: "調達ポータルで企業名義で取得（ICカード）", at: "07/30 10:20" },
    work: "見積回収中", bidPrice: null,
    lots: [
      { no: 1, item: "日常清掃", spec: "平日 18:00〜21:00／延床 18,400㎡", qty: 12, unit: "月", trade: "清掃" },
      { no: 2, item: "定期清掃（床維持）", spec: "ワックス塗替 共用部", qty: 4, unit: "回", trade: "清掃" },
      { no: 3, item: "ガラス清掃", spec: "外部・内部", qty: 2, unit: "回", trade: "清掃" },
      { no: 4, item: "受水槽・高置水槽清掃", spec: "各年2回", qty: 4, unit: "回", trade: "貯水槽清掃" },
      { no: 5, item: "ねずみ・昆虫等防除", spec: "全館", qty: 2, unit: "回", trade: "害虫防除" },
      { no: 6, item: "一般廃棄物 収集運搬", spec: "週2回", qty: 12, unit: "月", trade: "廃棄物処理" },
      { no: 7, item: "産業廃棄物 処理", spec: "マニフェスト管理含む", qty: 12, unit: "月", trade: "廃棄物処理" },
    ],
    forms: [
      form("入札書", "様式第1号", "未着手", "電子調達システム上で入力（提出は開札日まで）"),
      form("委任状", "様式第2号", "完了", "代表者印。前回案件の内容を流用できます"),
      form("資格審査結果通知書の写し", "—", "完了", "有効期限 2028/03/31 のものを添付"),
      form("履行実績調書", "別紙5", "作成中", "延床10,000㎡以上の官公庁施設の実績1件。〇〇税務署の実績が使えます"),
      form("履行体制図・作業員名簿", "別紙6", "未着手", "協力会社が確定してから作成します"),
      form("誓約書", "様式第4号", "未着手", "暴力団排除・人権尊重の誓約"),
    ],
    questions: [
      { id: "Q1", text: "特記仕様書 5-2 の受水槽清掃について、清掃時の断水手配は発注機関側で行うという理解でよろしいでしょうか。", basis: "仕様書 5-2 に断水手配の記載がないため", status: "送信済", answer: null },
      { id: "Q2", text: "日常清掃の作業時間が18:00〜21:00と指定されていますが、定期清掃・ガラス清掃も同時間帯に限定されますか。", basis: "仕様書 3章と4章で作業時間の記載が分かれているため", status: "下書き", answer: null },
    ],
    award: null,
    analysis: {
      summary: "地上11階・地下2階（延床 18,400㎡）の日常清掃・定期清掃。貯水槽清掃、害虫防除、廃棄物処理を含む単年度契約。",
      quals: ["全省庁統一資格（役務の提供等）B等級以上", "建築物環境衛生総合管理業の登録", "同種業務（延床10,000㎡以上の官公庁施設）実績 直近3年で1件以上"],
      conditions: ["単体企業のみ（JV不可）", "履行体制図・作業員名簿の提出必要", "質問は 08/01 17:00 まで"],
      trades: [
        { trade: "清掃", conf: 97, evidence: "仕様書 3章「日常清掃 18,400㎡／定期清掃 年4回」" },
        { trade: "貯水槽清掃", conf: 92, evidence: "仕様書 5-2「受水槽・高置水槽 各年2回」" },
        { trade: "害虫防除", conf: 88, evidence: "仕様書 5-4「ねずみ・昆虫等防除 年2回」" },
        { trade: "廃棄物処理", conf: 81, evidence: "仕様書 6章「一般・産業廃棄物の収集運搬」" },
        { trade: "設備保守", conf: 28, evidence: "設備点検は別契約と明記。対象外と判断", skip: true },
      ],
      notes: ["執務中の作業。作業時間は平日 18:00〜21:00 に限定", "産廃は東京都の許可が必要", "履行実績調書の様式が別紙5に指定"],
      official: "調達ポータルから企業名義で入札説明書を取得（システム取得分は正式取得に代わりません）",
    },
  },
  {
    id: "T-2026-000851", dedupe: "JMA-HQ/2026-072-B/2026-08-11",
    name: "気象庁本庁 機械警備業務", agency: "気象庁", org: "総務部 会計課", noticeNo: "2026-072-B",
    kind: "役務", qualCat: "役務の提供等", item: "警備", grade: "C以上", areas: ["関東・甲信越"],
    noticeDate: "2026/07/28", submitDeadline: "2026/08/11 12:00", qaDeadline: "2026/08/04 17:00", bidOpen: "2026/08/21 13:30",
    place: "東京都港区虎ノ門3-6-9", termFrom: "2026/10/01", termTo: "2029/09/30", budget: null,
    url: "https://www.example-jma.go.jp/bid/2026-072-B.pdf", via: "公開Webページ", connector: "agency",
    fetchedAt: "07/30 04:18", updatedAt: "07/30 05:44", collect: "公開中", failure: null, parse: "完了",
    proposal: { state: "配信済", at: "07/30 05:47", reason: null },
    docs: [d("公告", 1, "07/30 04:19", "公告.pdf"), d("入札説明書", 1, "07/30 04:20", "入札説明書.pdf"), d("仕様書", 1, "07/30 04:22", "仕様書.pdf"), d("数量表", 0, null, null, true), d("様式", 1, "07/30 04:22", "様式.docx")],
    official: { state: "申請中", how: "公告記載のメール窓口へ交付申請（07/30 09:10 送信済）", at: "07/30 09:10" },
    work: "募集開始", bidPrice: null,
    lots: [
      { no: 1, item: "機械警備", spec: "24時間365日・遠隔監視", qty: 36, unit: "月", trade: "警備" },
      { no: 2, item: "異常時対処", spec: "到着25分以内", qty: 36, unit: "月", trade: "警備" },
      { no: 3, item: "警備機器の保守", spec: "既設機器・故障対応含む", qty: 36, unit: "月", trade: "設備保守" },
    ],
    forms: [
      form("入札書", "様式第1号", "未着手", ""),
      form("委任状", "様式第2号", "未着手", ""),
      form("資格審査結果通知書の写し", "—", "未着手", ""),
      form("警備業認定証の写し", "—", "未着手", "1号・4号の認定が必要"),
      form("誓約書", "様式第3号", "未着手", ""),
    ],
    questions: [
      { id: "Q1", text: "対処拠点からの到着時間25分以内は、平日夜間・休日を含む全時間帯での要件という理解でよろしいでしょうか。", basis: "仕様書 3章に時間帯の限定がないため", status: "下書き", answer: null },
    ],
    award: null,
    analysis: {
      summary: "本庁舎の機械警備（無人時間帯の遠隔監視・異常時対処）。3年契約。常駐警備は含まない。",
      quals: ["全省庁統一資格（役務の提供等）C等級以上", "警備業法第4条の認定（1号・4号）", "東京都内に対処拠点を有すること"],
      conditions: ["単体企業のみ", "3年間の複数年度契約", "機器は発注機関の既設を使用"],
      trades: [
        { trade: "警備", conf: 96, evidence: "仕様書 2章「機械警備 24時間365日」" },
        { trade: "設備保守", conf: 74, evidence: "仕様書 4章「警備機器の保守・故障対応」" },
      ],
      notes: ["数量表は添付なし。仕様書の別表が数量相当", "到着25分以内の拠点要件あり"],
      official: "公告記載のメール窓口へ交付申請",
    },
  },
  {
    id: "T-2026-000870", dedupe: "MAFF-RINYA/2026-R-208/2026-08-18",
    name: "関東森林管理局 事務用什器類の購入", agency: "林野庁", org: "関東森林管理局 経理課", noticeNo: "2026-R-208",
    kind: "物品", qualCat: "物品の販売", item: "什器類", grade: "C以上", areas: ["関東・甲信越"],
    noticeDate: "2026/07/27", submitDeadline: "2026/08/18 17:00", qaDeadline: "2026/08/07 17:00", bidOpen: "2026/08/28 11:00",
    place: "群馬県前橋市（納品先3箇所）", termFrom: "2026/09/01", termTo: "2026/11/30", budget: 8900000,
    url: "https://www.example-rinya.go.jp/bid/2026-R-208", via: "公開PDF", connector: "pdf",
    fetchedAt: "07/30 04:31", updatedAt: "07/30 05:47", collect: "公開中", failure: null, parse: "完了",
    proposal: { state: "提案対象", at: null, reason: null },
    docs: [d("公告", 1, "07/30 04:32", "公告.pdf"), d("入札説明書", 1, "07/30 04:33", "入札説明書.pdf"), d("仕様書", 1, "07/30 04:34", "仕様書_OCR.pdf"), d("数量表", 1, "07/30 04:35", "数量表_OCR.csv"), d("様式", 0, null, null, true)],
    official: { state: "未取得", how: "調達ポータルから取得", at: null },
    work: "募集開始", bidPrice: null,
    lots: [
      { no: 1, item: "事務机（W1200）", spec: "スチール・引出付", qty: 84, unit: "台", trade: "什器納入" },
      { no: 2, item: "事務椅子", spec: "肘付・キャスター", qty: 84, unit: "脚", trade: "什器納入" },
      { no: 3, item: "書架（3段）", spec: "スチール", qty: 46, unit: "台", trade: "什器納入" },
      { no: 4, item: "配送・設置", spec: "納品先3箇所（前橋・高崎・沼田）", qty: 1, unit: "式", trade: "什器納入" },
      { no: 5, item: "既存什器の撤去処分", spec: "214点相当", qty: 1, unit: "式", trade: "廃棄物処理" },
    ],
    forms: [form("入札書", "様式第1号", "未着手", ""), form("委任状", "様式第2号", "未着手", ""), form("資格審査結果通知書の写し", "—", "未着手", ""), form("内訳書", "様式第3号", "未着手", "数量表の行ごとに単価を記入します")],
    questions: [],
    award: null,
    analysis: {
      summary: "事務机・椅子・書架など計 214点の購入および設置。納品先は3箇所、既存什器の撤去処分を含む。",
      quals: ["全省庁統一資格（物品の販売）C等級以上", "納品先への配送・設置体制"],
      conditions: ["単体企業のみ", "納品は平日 9:00〜17:00", "既存什器の処分費は落札者負担"],
      trades: [
        { trade: "什器納入", conf: 94, evidence: "数量表（OCR）214点の内訳" },
        { trade: "廃棄物処理", conf: 79, evidence: "仕様書 4章「既存什器の撤去・適正処分」" },
      ],
      notes: ["群馬県内への配送。協力会社の対応エリア外の可能性あり", "数量表はOCR読取り。単価入力前に原本確認を推奨"],
      official: "調達ポータルから取得",
    },
  },
  {
    id: "T-2026-000874", dedupe: "NPB-HQ/2026-J-051/2026-08-20",
    name: "国立印刷局 情報処理業務の委託", agency: "国立印刷局", org: "情報システム部", noticeNo: "2026-J-051",
    kind: "役務", qualCat: "役務の提供等", item: "情報処理", grade: "A", areas: ["関東・甲信越"],
    noticeDate: "2026/07/29", submitDeadline: "2026/08/20 17:00", qaDeadline: "2026/08/08 17:00", bidOpen: "2026/09/02 14:00",
    place: "東京都港区", termFrom: "2026/10/01", termTo: "2027/09/30", budget: null,
    url: "https://www.example-npb.go.jp/bid/2026-J-051", via: "電子調達システム", connector: "geps",
    fetchedAt: "07/30 04:07", updatedAt: "07/30 05:43", collect: "公開中", failure: null, parse: "完了",
    proposal: { state: "対象外", at: "07/30 05:43", reason: "条件不足（営業品目「情報処理」が未登録・A等級・ISO27001が未充足）" },
    docs: [d("公告", 1, "07/30 04:07", "公告.pdf"), d("入札説明書", 1, "07/30 04:08", "入札説明書.pdf"), d("仕様書", 1, "07/30 04:09", "仕様書.pdf"), d("数量表", 0, null, null, true), d("様式", 1, "07/30 04:09", "様式.zip")],
    official: { state: "未取得", how: "調達ポータル", at: null },
    work: "募集開始", bidPrice: null, lots: [], forms: [], questions: [], award: null,
    analysis: {
      summary: "基幹システムの運用保守および問い合わせ対応。常駐3名。",
      quals: ["全省庁統一資格（役務の提供等）A等級", "営業品目「情報処理」の登録", "ISO/IEC 27001 認証", "同種業務実績 直近5年で2件以上"],
      conditions: ["単体企業のみ", "常駐要員の身元確認書類が必要"],
      trades: [], notes: [], official: "調達ポータル",
    },
  },
  {
    id: "T-2026-000866", dedupe: "MOD-KANTO/R8-K-114/2026-08-14",
    name: "〇〇駐屯地 植栽等管理業務", agency: "防衛省", org: "関東防衛局 調達部", noticeNo: "R8-K-114",
    kind: "役務", qualCat: "役務の提供等", item: "植栽等管理", grade: "C以上", areas: ["関東・甲信越"],
    noticeDate: "2026/07/29", submitDeadline: "2026/08/14 17:00", qaDeadline: "2026/08/06 17:00", bidOpen: "2026/08/25 10:00",
    place: "千葉県船橋市（駐屯地内）", termFrom: "2026/09/15", termTo: "2027/03/31", budget: 12600000,
    url: "https://www.example-mod.go.jp/kanto/bid/R8-K-114", via: "電子調達システム", connector: "geps",
    fetchedAt: "07/30 04:29", updatedAt: "07/30 04:29", collect: "取得中",
    failure: { reason: "資料DLに企業ICカード認証が必要な区分。2回リトライ後も失敗", at: "07/30 04:29", retry: 2 },
    parse: "未実施", proposal: null,
    docs: [d("公告", 1, "07/30 04:28", "公告.pdf"), d("入札説明書", 0, null, null), d("仕様書", 0, null, null), d("数量表", 0, null, null), d("様式", 0, null, null)],
    official: { state: "未取得", how: "調達ポータル（企業ICカード）", at: null },
    work: "募集開始", bidPrice: null, lots: [], forms: [], questions: [], award: null, analysis: null,
  },
  {
    id: "T-2026-000877", dedupe: "AIST-TSUKUBA/2026-M-330/2026-08-06",
    name: "〇〇研究所 実験用機器の購入", agency: "国立研究開発法人 〇〇研究所", org: "つくばセンター 契約室", noticeNo: "2026-M-330",
    kind: "物品", qualCat: "物品の販売", item: "理化学機器", grade: "C以上", areas: ["関東・甲信越"],
    noticeDate: "2026/07/26", submitDeadline: "2026/08/06 15:00", qaDeadline: "2026/07/31 17:00", bidOpen: "2026/08/17 10:00",
    place: "茨城県つくば市", termFrom: "2026/09/01", termTo: "2026/10/31", budget: 6400000,
    url: "（メール交付）", via: "メール交付", connector: "mail",
    fetchedAt: "07/30 04:35", updatedAt: "07/30 04:36", collect: "取得済", failure: null, parse: "処理中", proposal: null,
    docs: [d("公告", 1, "07/30 04:35", "公告.pdf"), d("入札説明書", 1, "07/30 04:35", "入札説明書.pdf"), d("仕様書", 1, "07/30 04:36", "仕様書.pdf"), d("数量表", 0, null, null), d("様式", 0, null, null)],
    official: { state: "未取得", how: "交付メールへの返信で参加表明", at: null },
    work: "募集開始", bidPrice: null, lots: [], forms: [], questions: [], award: null, analysis: null,
  },
  {
    id: "T-2026-000801", dedupe: "MOF-KANTO/2026-0620-007/2026-07-10",
    name: "〇〇税務署 庁舎清掃業務", agency: "関東財務局", org: "〇〇税務署", noticeNo: "2026-0620-007",
    kind: "役務", qualCat: "役務の提供等", item: "建物管理等", grade: "C以上", areas: ["関東・甲信越"],
    noticeDate: "2026/06/20", submitDeadline: "2026/07/10 15:00", qaDeadline: "2026/07/03 17:00", bidOpen: "2026/07/22 10:00",
    place: "千葉県千葉市", termFrom: "2026/09/01", termTo: "2027/08/31", budget: 9200000,
    url: "https://www.example-mof.go.jp/nyusatsu/2026-0620-007.html", via: "電子調達システム", connector: "geps",
    fetchedAt: "06/21 04:05", updatedAt: "07/23 10:12", collect: "終了", failure: null, parse: "完了",
    proposal: { state: "検討中", at: "06/21 05:30", reason: null },
    docs: ["公告", "入札説明書", "仕様書", "数量表", "様式"].map((k) => d(k, 1, "06/21 04:06", `${k}.pdf`)),
    official: { state: "取得済", how: "調達ポータルで取得（06/25）", at: "06/25 11:00" },
    work: "落札", bidPrice: 8740000,
    lots: [{ no: 1, item: "日常清掃", spec: "延床 3,100㎡", qty: 12, unit: "月", trade: "清掃" }],
    forms: [form("入札書", "様式第1号", "完了", ""), form("委任状", "様式第2号", "完了", ""), form("内訳書", "様式第3号", "完了", "")],
    questions: [],
    award: { date: "2026/07/22", winner: "自社", amount: 8740000, budget: 9200000, note: "2社応札。落札率 95.0%" },
    analysis: {
      summary: "庁舎（延床 3,100㎡）の日常清掃・定期清掃。単年度。",
      quals: ["全省庁統一資格（役務の提供等）C等級以上"], conditions: ["単体企業のみ"],
      trades: [{ trade: "清掃", conf: 96, evidence: "仕様書 2章" }],
      notes: ["07/22 開札。落札"], official: "調達ポータル",
    },
  },
];

/* ── 収集端末（ICカードでの資料取得を行う社内機） ───────────────────────── */
const AGENTS = [
  { id: "agent-01", label: "収集端末1（本社）", status: "稼働中", lastBeat: "たった今", certExpires: "2027/09/30", certDays: 426, today: 12, note: "" },
  { id: "agent-02", label: "収集端末2（予備）", status: "待機", lastBeat: "07/30 04:00", certExpires: "2027/09/30", certDays: 426, today: 0, note: "カード未挿入。障害時に切替" },
];

/* ── 協力会社の開拓候補（AIが収集した会社） ─────────────────────────────── */
const SEED_PROSPECTS = [
  { id: "R1", name: "前橋オフィス設備", trade: "什器納入", area: "群馬県前橋市", source: "業界団体の会員名簿", conf: 0.86,
    tel: "027-***-1180", channel: "メール", web: "https://example-maebashi.co.jp",
    note: "官公庁への納入実績の記載あり。前橋・高崎・沼田すべて配送圏内", state: "未送信", history: [] },
  { id: "R2", name: "上州家具商会", trade: "什器納入", area: "群馬県高崎市", source: "公開の落札情報（他社落札分）", conf: 0.78,
    tel: "027-***-4420", channel: "メール", web: "https://example-joshu.co.jp",
    note: "同種案件で過去に落札実績。設置作業も自社対応", state: "送信済",
    history: [{ at: "07/29 10:12", kind: "送信", text: "初回メール（代表アドレス）／件名：什器納入の見積のご相談（官公庁案件）" }] },
  { id: "R3", name: "北関東クリーンサービス", trade: "廃棄物処理", area: "群馬県前橋市", source: "産業廃棄物処理業者名簿", conf: 0.91,
    tel: "027-***-7733", channel: "メール", web: "https://example-kitakanto.co.jp",
    note: "産廃収集運搬の許可あり。什器の撤去処分に対応", state: "返信あり（前向き）",
    history: [
      { at: "07/29 10:14", kind: "送信", text: "初回メール（代表アドレス）" },
      { at: "07/30 08:40", kind: "返信", text: "「案件が出たらご連絡ください。数量が分かれば見積出せます」" },
    ] },
  { id: "R4", name: "赤城環境", trade: "廃棄物処理", area: "群馬県渋川市", source: "産業廃棄物処理業者名簿", conf: 0.64,
    tel: "0279-**-2200", channel: "フォームのみ", web: "https://example-akagi.co.jp",
    note: "メール非公開。問い合わせフォームのみ", state: "対象外",
    excludeReason: "「現在は新規のお取引を受けていない」との返信",
    history: [
      { at: "07/29 11:02", kind: "送信", text: "問い合わせフォーム（担当者が送信）" },
      { at: "07/29 16:20", kind: "返信", text: "「新規のお取引は受けておりません」" },
      { at: "07/29 16:25", kind: "除外", text: "除外リストに登録。以後は送信しない" },
    ] },
  { id: "R5", name: "つくば理化サービス", trade: "理化学機器", area: "茨城県つくば市", source: "研究機関の公開調達実績", conf: 0.72,
    tel: "029-***-8890", channel: "メール", web: "https://example-tsukuba.co.jp",
    note: "実験機器の納入・据付に対応", state: "未送信", history: [] },
  { id: "R6", name: "常総設備工業", trade: "設備保守", area: "茨城県つくば市", source: "業界団体の会員名簿", conf: 0.58,
    tel: "029-***-3311", channel: "フォームのみ", web: "https://example-joso.co.jp",
    note: "空調・電気の法定点検。官公庁実績は不明", state: "未送信", history: [] },
  { id: "R7", name: "都心ビルサービス", trade: "清掃", area: "東京都千代田区", source: "公開の落札情報", conf: 0.88,
    tel: "03-****-1122", channel: "メール", web: "https://example-toshin.co.jp",
    note: "名寄せで既存の協力会社と一致", state: "登録済み（既存）", history: [] },
];

/* ── 見積・返信受信箱 ─────────────────────────────────────────────────────── */
const SEED_QUOTES = [
  { id: "Q01", tid: "T-2026-000842", trade: "清掃", cid: "P01", amount: 18400000, at: "08/01 09:12", due: "2026/08/04 17:00", ch: "LINE", memo: "夜間帯6名で計上", src: "自動取込" },
  { id: "Q02", tid: "T-2026-000842", trade: "清掃", cid: "P02", amount: 17250000, at: "08/02 15:40", due: "2026/08/04 17:00", ch: "メール", memo: "定期清掃は年3回の前提", src: "自動取込" },
  { id: "Q03", tid: "T-2026-000842", trade: "貯水槽清掃", cid: "P07", amount: 860000, at: "08/01 11:30", due: "2026/08/04 17:00", ch: "LINE", memo: "", src: "自動取込" },
  { id: "Q04", tid: "T-2026-000842", trade: "貯水槽清掃", cid: "P02", amount: null, at: null, due: "2026/08/04 17:00", ch: "メール", memo: "", src: null },
  { id: "Q05", tid: "T-2026-000842", trade: "害虫防除", cid: "P07", amount: 480000, at: "08/01 11:32", due: "2026/08/04 17:00", ch: "LINE", memo: "年2回・全館", src: "自動取込" },
  { id: "Q06", tid: "T-2026-000842", trade: "廃棄物処理", cid: "P08", amount: null, at: null, due: "2026/08/04 17:00", ch: "LINE", memo: "", src: null },
];
const SEED_INBOX = [
  { id: "I1", tid: "T-2026-000842", cid: "P08", trade: "廃棄物処理", via: "LINE", at: "たった今", amount: 2640000,
    text: "お世話になります。城南環境です。廃棄物処理の件、月次収集・マニフェスト管理込みで 2,640,000円（年額・税抜）でお願いします。産廃許可証は別途お送りします。" },
  { id: "I2", tid: "T-2026-000842", cid: "P02", trade: "貯水槽清掃", via: "メール", at: "たった今", amount: null,
    text: "関東クリーンメンテです。受水槽の件、現地を確認しないと数量が確定できないため、08/05に下見をお願いできますでしょうか。金額は下見後にご連絡します。" },
];

const SEED_APPROVALS = [
  { id: "A1", tid: "T-2026-000851", type: "見積依頼", note: "警備・設備保守の2業種。到着25分以内の要件を満たす拠点を持つ2社を提案" },
  { id: "A2", tid: "T-2026-000842", type: "質問送信", note: "作業時間の適用範囲について質問案を作成。質問期限は 08/01 17:00（残2日）" },
  { id: "A3", tid: "T-2026-000866", type: "手動登録", note: "資料DLに企業ICカード認証が必要。管理者による手動取得が必要" },
];

const SEED_LOG = [
  { t: "04:00", text: "収集ジョブ開始。コネクタ6件を巡回", kind: "ok" },
  { t: "04:18", text: "新規19件を検知。重複9件をマージし10件を案件マスタへ登録", kind: "ok" },
  { t: "04:29", text: "T-2026-000866 の資料取得に失敗（ICカード認証）。手動登録の承認待ちへ", kind: "warn" },
  { t: "04:36", text: "資料85ファイルを取得。数量表2件をCSVへ構造化", kind: "ok" },
  { t: "05:41", text: "T-2026-000842 の必要協力業種を判断し、数量表を業種別に割当（7行）", kind: "ai" },
  { t: "05:44", text: "T-2026-000842 の質問案を2件作成（うち1件は送信済）", kind: "ai" },
  { t: "05:47", text: "案件マスタへ公開後、自社条件と照合。提案3件・対象外2件", kind: "ai" },
  { t: "09:12", text: "都心ビルサービスからLINE返信を受信し、見積 ¥18,400,000 を自動取込", kind: "ok" },
];

/* ── 判定ロジック（純関数） ───────────────────────────────────────────────── */
function evaluateFit(t, c = COMPANY) {
  const ok = [], ng = [], unknown = [];
  const specMissing = (t.docs ?? []).some((x) => x.kind === "仕様書" && !x.got);
  let score = 0;
  const need = (t.analysis?.trades ?? []).filter((x) => !x.skip).map((x) => x.trade);
  if (c.quals.includes(t.qualCat)) { score += 20; ok.push(`資格区分「${t.qualCat}」を保有`); } else ng.push(`資格区分「${t.qualCat}」が未保有`);
  if (c.items.includes(t.item)) { score += 20; ok.push(`営業品目「${t.item}」で登録済`); } else ng.push(`営業品目「${t.item}」が未登録`);
  const mine = c.grades[t.qualCat], req = (t.grade || "D").replace("以上", "");
  if (mine && GRADE_ORDER[mine] >= GRADE_ORDER[req]) { score += 15; ok.push(`等級 ${mine}（要件 ${t.grade}）を充足`); } else ng.push(`等級が不足（自社 ${mine ?? "登録なし"}／要件 ${t.grade}）`);
  if (t.areas.some((a) => c.areas.includes(a))) { score += 15; ok.push(`競争参加地域「${t.areas[0]}」に登録`); } else ng.push(`競争参加地域「${t.areas[0]}」が対象外`);
  if (t.budget == null) { score += 5; ok.push("予定価格は非公表（規模から判断が必要）"); }
  else if (t.budget >= c.min && t.budget <= c.max) { score += 10; ok.push(`予定価格 ${man(t.budget)} が希望範囲内`); }
  else ng.push(`予定価格 ${man(t.budget)} が希望範囲外`);
  const dl = daysLeft(t.submitDeadline);
  if (dl >= c.minDays) { score += 10; ok.push(`提出期限まで ${dl}日（下限 ${c.minDays}日）`); } else ng.push(`提出期限まで ${dl}日で準備期間が不足`);
  if (specMissing) {
    unknown.push("必要な協力業種（仕様書が取得できていないため判定できません）");
  } else if (need.length === 0) score += 5;
  else {
    const covered = need.filter((n) => c.partnerTrades.includes(n));
    score += Math.round((covered.length / need.length) * 10);
    if (covered.length === need.length) ok.push(`必要協力業種 ${need.length}業種すべてに登録会社あり`);
    else ng.push(`協力会社が未登録の業種：${need.filter((n) => !c.partnerTrades.includes(n)).join("・")}`);
  }
  const hard = !c.quals.includes(t.qualCat) || !c.items.includes(t.item) || !(mine && GRADE_ORDER[mine] >= GRADE_ORDER[req]);
  return { score: Math.min(100, score), ok, ng, unknown, verdict: hard ? "条件不足" : score >= 80 ? "推奨" : "要確認", need, dl, specMissing };
}

const recommendScore = (p, t) => {
  const area = p.areas.some((a) => t.place.includes(a)) ? 1 : 0;
  return Math.round(p.adopt * 40 + Math.max(0, 1 - p.resp / 12) * 25 + area * 20 + (p.rating / 5) * 15);
};
const recommendFor = (trade, t) =>
  PARTNERS.filter((p) => p.trades.includes(trade)).map((p) => ({ ...p, score: recommendScore(p, t) })).sort((a, b) => b.score - a.score);
const reasonFor = (p, t) => {
  const r = [];
  if (p.areas.some((a) => t.place.includes(a))) r.push("対応エリア一致");
  if (p.adopt >= 0.4) r.push(`採用率 ${Math.round(p.adopt * 100)}%`);
  if (p.resp <= 4) r.push(`平均回答 ${p.resp}h`);
  return r.length ? r.join("・") : "業種一致（エリアは要確認）";
};

/* 原価集計 → 応札価格の検討 */
function costing(t, quotes, picks) {
  const trades = [...new Set(quotes.map((q) => q.trade))];
  const rows = trades.map((tr) => {
    const cands = quotes.filter((q) => q.trade === tr && q.amount != null);
    const lowest = cands.length ? cands.reduce((a, b) => (a.amount <= b.amount ? a : b)) : null;
    const picked = cands.find((q) => q.id === picks[tr]) ?? lowest;
    return { trade: tr, picked, count: cands.length, waiting: quotes.filter((q) => q.trade === tr && q.amount == null).length };
  });
  const cost = rows.reduce((n, r) => n + (r.picked?.amount ?? 0), 0);
  const overhead = cost * COMPANY.overhead;
  const profit = (cost + overhead) * COMPANY.profit;
  const bid = cost + overhead + profit;
  const mr = marketRate(t.item);
  const target = t.budget && mr ? t.budget * mr.rate : null;
  return { rows, cost, overhead, profit, bid, mr, target, waiting: rows.reduce((n, r) => n + r.waiting, 0) };
}

/* 案件の進め方（素人向けガイド）— 状態は他データから導出する */
function guideSteps(t, quotes, cost) {
  const qs = quotes;
  const f = evaluateFit(t);
  const answered = qs.filter((q) => q.amount != null).length;
  const formsDone = (t.forms ?? []).filter((x) => x.state === "完了").length;
  const step = (key, label, why, done, active, you, ai, due, tab) => ({ key, label, why, done, active, you, ai, due, tab });
  const s = [
    step("propose", "案件が届く", "毎朝AIが公告を集めて解析し、条件に合う案件だけを届けます。探す作業は不要です。",
      !!t.proposal, false, null, `適合率 ${f.score}%で提案`, null, "fit"),
    step("judge", "参加するか決める", "資格・等級・地域を自動で照合済み。足りない条件があればここで分かります。",
      ["検討中", "対象外"].includes(t.proposal?.state), t.proposal?.state === "配信済" || t.proposal?.state === "提案対象",
      "「参加を検討する」を押す", "適合理由と非適合理由を提示", null, "fit"),
    step("official", "資料を正式に取得する", "システムが取った資料は解析用です。参加するには御社名義での取得が必要です。",
      t.official.state === "取得済", t.proposal?.state === "検討中" && t.official.state !== "取得済",
      "取得手順に沿って取得", "取得先と手順を案内", t.submitDeadline, "docs"),
    step("qa", "分からない点を質問する", "質問期限を過ぎると聞けません。曖昧な条件はここで潰します。",
      (t.questions ?? []).some((q) => q.status !== "下書き"), daysLeft(t.qaDeadline) >= 0 && (t.questions ?? []).some((q) => q.status === "下書き"),
      "質問案を確認して送信", `質問案 ${(t.questions ?? []).length}件を作成`, t.qaDeadline, "qa"),
    step("request", "協力会社に見積を頼む", "必要な業種をAIが判断し、数量表の該当行だけを切り出して依頼します。",
      qs.length > 0, t.official.state !== "未取得" && qs.length === 0,
      "送信内容を承認", "業種判断・依頼先選定・依頼文作成", null, "request"),
    step("collect", "見積を集める", "返信は自動で取り込まれます。未回答には期限前に催促します。",
      qs.length > 0 && answered === qs.length, qs.length > 0 && answered < qs.length,
      "取り込み結果を確認", `${answered}/${qs.length}社 回答済`, null, "compare"),
    step("price", "応札価格を決める", "原価を集計し、同種案件の落札率から目安を出します。ここが勝敗の分かれ目です。",
      !!t.bidPrice, qs.length > 0 && answered > 0 && !t.bidPrice,
      "価格を決定する", cost ? `原価 ${man(cost.cost)} を集計` : null, null, "compare"),
    step("forms", "提出書類を揃える", "様式から必要書類を自動で洗い出します。抜けがあると失格になります。",
      (t.forms ?? []).length > 0 && formsDone === (t.forms ?? []).length, (t.forms ?? []).length > 0 && formsDone < (t.forms ?? []).length,
      "書類を作成・添付", `必要書類 ${(t.forms ?? []).length}件を抽出`, t.submitDeadline, "forms"),
    step("submit", "提出する", "電子調達システムで提出します。提出後は取り下げできません。",
      ["提出済", "落札", "施工中", "完工"].includes(t.work), false,
      "電子調達システムで提出", null, t.submitDeadline, "forms"),
    step("result", "結果を記録する", "落札額を記録すると、次回以降の価格判断に使う相場データになります。",
      !!t.award, ["提出済"].includes(t.work), "開札結果を入力", "相場データへ反映", t.bidOpen, "result"),
  ];
  const next = s.find((x) => !x.done);
  return { steps: s, done: s.filter((x) => x.done).length, next };
}

/* ── UI プリミティブ ──────────────────────────────────────────────────────── */
const Panel = ({ title, right, children, dense }) => (
  <section className="ai-panel bg-white border border-slate-200 rounded-md">
    {title && (
      <header className="ai-hd px-3 py-2 border-b border-slate-200">
        <h2 className="text-xs font-semibold tracking-wide text-slate-700">{title}</h2>
        {right}
      </header>
    )}
    <div className={dense ? "" : "p-3"}>{children}</div>
  </section>
);
const Pill = ({ children, tone = "slate" }) => {
  const map = {
    slate: "bg-slate-100 text-slate-700 border-slate-200", blue: "bg-blue-50 text-blue-800 border-blue-200",
    green: "bg-emerald-50 text-emerald-800 border-emerald-200", amber: "bg-amber-50 text-amber-800 border-amber-200",
    rose: "bg-rose-50 text-rose-800 border-rose-200", violet: "bg-violet-50 text-violet-800 border-violet-200",
  };
  return <span className={`inline-flex items-center gap-1 border px-1.5 py-0.5 rounded text-xs ${map[tone]}`}>{children}</span>;
};
const CollectPill = ({ s }) => <span className={`inline-block border px-1.5 py-0.5 rounded text-xs whitespace-nowrap ${COLLECT_STYLE[s]}`}>{s}</span>;
const WorkPill = ({ s }) => <span className={`inline-block border px-1.5 py-0.5 rounded text-xs whitespace-nowrap ${WORK_STYLE[s]}`}>{s}</span>;
const ProposePill = ({ s }) => (s ? <span className={`inline-block border px-1.5 py-0.5 rounded text-xs whitespace-nowrap ${PROPOSE_STYLE[s]}`}>{s}</span> : <span className="text-slate-300 text-xs">未照合</span>);
const Verdict = ({ v }) =>
  v === "推奨" ? <Pill tone="green"><CheckCircle2 size={12} />参加できます</Pill>
  : v === "条件不足" ? <Pill tone="rose"><X size={12} />参加できません</Pill>
  : <Pill tone="amber"><AlertTriangle size={12} />要確認</Pill>;

/* 用語のやさしい説明 */
const Term = ({ w }) => (
  <span className="ai-term" title={TERMS[w] ?? ""}>{w}<HelpCircle size={11} className="inline ml-0.5 text-slate-400" /></span>
);
const Field = ({ label, children }) => (
  <div className="grid grid-cols-3 gap-2 py-1.5 border-b border-slate-100 last:border-0">
    <dt className="text-xs text-slate-500">{label}</dt><dd className="col-span-2 text-xs text-slate-800">{children}</dd>
  </div>
);
const Btn = ({ children, onClick, kind = "default", size = "md", disabled, title }) => {
  const kinds = {
    default: "bg-white border-slate-300 text-slate-700 hover:bg-slate-50",
    primary: "bg-blue-800 border-blue-800 text-white hover:bg-blue-900",
    ghost: "bg-transparent border-transparent text-slate-600 hover:bg-slate-100",
  };
  return (
    <button title={title} disabled={disabled} onClick={onClick}
      className={`inline-flex items-center justify-center gap-1.5 rounded border font-medium disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-blue-300 ${kinds[kind]} ${size === "sm" ? "text-xs px-2 py-1" : "text-xs px-3 py-1.5"}`}>
      {children}
    </button>
  );
};
const Ch = ({ ch }) => (ch === "LINE" ? <Pill tone="green"><MessageSquare size={11} />LINE</Pill> : <Pill><Mail size={11} />メール</Pill>);
const Bar = ({ v, tone = "bg-blue-700" }) => (
  <div className="h-1.5 bg-slate-100 rounded overflow-hidden"><div className={`h-full ${tone}`} style={{ width: `${Math.max(0, Math.min(100, v))}%` }} /></div>
);
const Stepper = ({ list, current }) => {
  const i = list.indexOf(current);
  return (
    <ol className="flex flex-wrap items-center gap-1">
      {list.map((s, k) => (
        <li key={s} className="flex items-center gap-1">
          <span className={`px-2 py-1 rounded text-xs border whitespace-nowrap ${k < i ? "bg-slate-100 text-slate-500 border-slate-200" : k === i ? "bg-slate-800 text-white border-slate-800" : "bg-white text-slate-400 border-slate-200"}`}>{s}</span>
          {k < list.length - 1 && <ChevronRight size={12} className="text-slate-300" />}
        </li>
      ))}
    </ol>
  );
};
const Due = ({ s, label }) => {
  const dl = daysLeft(s);
  return (
    <span className={`text-xs tabular-nums ${dl < 0 ? "text-slate-400" : dl <= 2 ? "text-rose-700 font-semibold" : dl <= 5 ? "text-amber-700" : "text-slate-600"}`}>
      {label ? label + " " : ""}{s}{dl >= 0 ? `（残${dl}日）` : "（終了）"}
    </span>
  );
};

/* =============================================================================
   App
============================================================================= */
export default function AiNyusatsuBu() {
  const [view, setView] = useState("home");
  const [tenders, setTenders] = useState(SEED_TENDERS);
  const [quotes, setQuotes] = useState(SEED_QUOTES);
  const [inbox, setInbox] = useState(SEED_INBOX);
  const [approvals, setApprovals] = useState(SEED_APPROVALS);
  const [log, setLog] = useState(SEED_LOG);
  const [openId, setOpenId] = useState(null);
  const [tab, setTab] = useState("guide");
  const [draft, setDraft] = useState(null);
  const [official, setOfficial] = useState(null);
  const [importing, setImporting] = useState(null);
  const [prospects, setProspects] = useState(SEED_PROSPECTS);
  const [added, setAdded] = useState([]);
  const [toast, setToast] = useState(null);

  const tender = tenders.find((t) => t.id === openId) || null;
  const notify = (m) => { setToast(m); window.setTimeout(() => setToast(null), 2800); };
  const addLog = (text, kind = "ok") => setLog((l) => [...l, { t: "たった今", text, kind }]);
  const patch = (id, obj) => setTenders((ts) => ts.map((t) => (t.id === id ? { ...t, ...obj, updatedAt: "たった今" } : t)));
  const open = (id, tb = "guide") => { setOpenId(id); setTab(tb); setView("detail"); };

  const retry = (id) => { patch(id, { collect: "取得中" }); addLog(`${id} の資料取得を再試行`, "warn"); notify("再取得を実行しました"); };
  const manualRegister = (id) => {
    const t = tenders.find((x) => x.id === id);
    const docs = t.docs.map((x) => ({ ...x, got: 1, at: x.at ?? "たった今", src: x.src ?? `${x.kind}（手動登録）.pdf` }));
    patch(id, {
      collect: "解析完了", parse: "完了", failure: null, docs,
      analysis: {
        summary: "手動登録した資料をAIが解析しました。（プロトタイプでは簡略表示）",
        quals: [`全省庁統一資格（${t.qualCat}）${t.grade}`], conditions: ["単体企業のみ"],
        trades: [{ trade: "植栽", conf: 93, evidence: "仕様書 2章「除草・剪定 年3回」" }, { trade: "廃棄物処理", conf: 71, evidence: "仕様書 3章「刈草の処分」" }],
        notes: ["駐屯地内のため入場手続きに事前申請が必要"], official: t.official.how,
      },
      forms: [form("入札書", "様式第1号", "未着手", ""), form("委任状", "様式第2号", "未着手", ""), form("資格審査結果通知書の写し", "—", "未着手", "")],
    });
    setApprovals((a) => a.filter((x) => !(x.tid === id && x.type === "手動登録")));
    addLog(`${id} の資料を手動登録し、AI解析まで完了`, "ai");
    notify("手動登録と解析が完了しました");
  };
  const runParse = (id) => {
    patch(id, { collect: "AI解析中", parse: "処理中" });
    window.setTimeout(() => { patch(id, { collect: "解析完了", parse: "完了" }); notify("AI解析が完了しました"); }, 500);
    addLog(`${id} のAI解析を実行`, "ai");
  };
  const publish = (id) => {
    const t = tenders.find((x) => x.id === id);
    const f = evaluateFit(t);
    const proposal = f.verdict === "条件不足"
      ? { state: "対象外", at: "たった今", reason: `条件不足（${f.ng[0] ?? "要件未充足"}）` }
      : { state: "提案対象", at: "たった今", reason: null };
    patch(id, { collect: "公開中", proposal });
    addLog(`${id} を案件マスタへ公開し照合（適合率 ${f.score}%／${proposal.state}）`, "ai");
    notify(`公開しました（照合結果：${proposal.state}）`);
  };
  const setProposalState = (id, state) => {
    const t = tenders.find((x) => x.id === id);
    patch(id, { proposal: { ...(t.proposal ?? { reason: null }), state, at: "たった今" } });
    addLog(`${id} の提案ステータスを「${state}」に更新`, "ai");
    notify(`「${state}」にしました`);
  };
  const setOfficialState = (id, state) => {
    const t = tenders.find((x) => x.id === id);
    patch(id, { official: { ...t.official, state, at: state === "未取得" ? null : "たった今" } });
    setOfficial(null);
    addLog(`${id} の正式取得を「${state}」に更新`);
    notify(`正式取得を「${state}」にしました`);
  };
  const send = () => {
    if (!draft) return;
    const { tid, items, due } = draft;
    const add = [];
    items.forEach(({ trade, ids }) => ids.forEach((cid) => {
      const p = partnerById(cid);
      add.push({ id: `Q${Math.random().toString(36).slice(2, 7)}`, tid, trade, cid, amount: null, at: null, due, ch: p.line ? "LINE" : "メール", memo: "", src: null });
    }));
    setQuotes((qs) => [...qs, ...add]);
    patch(tid, { work: "見積回収中" });
    setApprovals((a) => a.filter((x) => !(x.tid === tid && x.type === "見積依頼")));
    addLog(`${tid} の見積依頼を ${add.length}社へ送信（回答期限 ${due}）`, "ai");
    setDraft(null);
    notify(`${add.length}社へ送信しました。返信は自動で取り込みます`);
    open(tid, "compare");
  };
  const remind = (q) => { addLog(`${q.tid} ${q.trade}：${partnerById(q.cid).name} へ催促を送信`, "warn"); notify(`${partnerById(q.cid).name} に催促を送信しました`); };
  const importReply = (item, amount) => {
    setQuotes((qs) => {
      const hit = qs.find((q) => q.tid === item.tid && q.cid === item.cid && q.trade === item.trade);
      if (hit) return qs.map((q) => (q === hit ? { ...q, amount, at: "たった今", memo: item.text.slice(0, 28) + "…", src: "自動取込" } : q));
      return [...qs, { id: `Q${Math.random().toString(36).slice(2, 7)}`, tid: item.tid, trade: item.trade, cid: item.cid, amount, at: "たった今", due: null, ch: item.via, memo: "", src: "自動取込" }];
    });
    setInbox((l) => l.filter((x) => x.id !== item.id));
    setImporting(null);
    addLog(`${partnerById(item.cid).name} の返信から見積 ${yen(amount)} を取り込み`, "ok");
    notify("見積を取り込みました");
  };
  const sendQuestion = (tid, qid) => {
    const t = tenders.find((x) => x.id === tid);
    patch(tid, { questions: t.questions.map((q) => (q.id === qid ? { ...q, status: "送信済" } : q)) });
    setApprovals((a) => a.filter((x) => !(x.tid === tid && x.type === "質問送信")));
    addLog(`${tid} の質問を発注機関へ送信`, "ai");
    notify("質問を送信しました");
  };
  const setForm = (tid, name, state) => {
    const t = tenders.find((x) => x.id === tid);
    patch(tid, { forms: t.forms.map((f) => (f.name === name ? { ...f, state } : f)) });
  };
  const recordAward = (id, amount, won) => {
    const t = tenders.find((x) => x.id === id);
    patch(id, {
      award: { date: "たった今", winner: won ? "自社" : "他社", amount, budget: t.budget ?? amount, note: won ? "自社が落札" : "他社が落札" },
      work: won ? "落札" : "提出済", collect: "終了",
    });
    addLog(`${id} の開札結果を記録（${won ? "落札" : "失注"} ${yen(amount)}）。相場データへ反映`, "ai");
    notify("結果を記録しました。相場データに反映されます");
  };
  const decidePrice = (tid, price) => {
    patch(tid, { bidPrice: price, work: "積算中" });
    addLog(`${tid} の応札価格を ${yen(price)} に決定`, "ai");
    notify("応札価格を決定しました");
  };

  const pHist = (r, kind, text) => ({ ...r, history: [...(r.history ?? []), { at: "たった今", kind, text }] });
  const sendProspect = (id) => {
    const r = prospects.find((x) => x.id === id);
    const via = r.channel === "メール" ? "初回メール（代表アドレス）" : "問い合わせフォーム（担当者が送信）";
    setProspects((ps) => ps.map((x) => (x.id === id ? { ...pHist(x, "送信", via), state: "送信済" } : x)));
    addLog(`${r.name}（${r.trade}）へ初回連絡：${via}`, "ai");
    notify(r.channel === "メール" ? "メールを送信しました" : "送信済みとして記録しました");
  };
  const replyProspect = (id, positive) => {
    const r = prospects.find((x) => x.id === id);
    setProspects((ps) => ps.map((x) => (x.id !== id ? x : positive
      ? { ...pHist(x, "返信", "前向きな返信"), state: "返信あり（前向き）" }
      : { ...pHist(pHist(x, "返信", "対応不可の返信"), "除外", "除外リストに登録。以後は送信しない"), state: "対象外", excludeReason: "対応不可の返信" })));
    addLog(`${r.name} から返信（${positive ? "前向き" : "対応不可"}）`, positive ? "ok" : "warn");
    notify(positive ? "返信を記録しました" : "除外リストに登録しました");
  };
  const registerProspect = (id) => {
    const r = prospects.find((x) => x.id === id);
    setProspects((ps) => ps.map((x) => (x.id === id ? { ...pHist(x, "登録", "協力会社マスタへ登録"), state: "登録済" } : x)));
    setAdded((a) => [...a, { id, name: r.name, trades: [r.trade], base: r.area }]);
    addLog(`${r.name} を協力会社に登録（${r.trade}／${r.area}）`, "ok");
    notify("協力会社に登録しました");
  };
  const restoreProspect = (id) => {
    setProspects((ps) => ps.map((x) => (x.id === id ? { ...pHist(x, "解除", "除外を解除"), state: "未送信", excludeReason: null } : x)));
    notify("除外を解除しました");
  };

  const nav = [
    { k: "home", label: "今日やること", icon: Home },
    { k: "start", label: "はじめかた", icon: Compass },
    { k: "proposals", label: "提案された案件", icon: Target },
    { k: "replies", label: "見積の返信", icon: Inbox, badge: inbox.length },
    { k: "master", label: "共通案件マスタ", icon: Database },
    { k: "engine", label: "案件収集エンジン", icon: Server },
    { k: "partners", label: "協力会社", icon: Users },
    { k: "partnerside", label: "協力会社の画面", icon: Store },
    { k: "market", label: "落札結果・相場", icon: Award },
    { k: "search", label: "資料をさがす", icon: Search },
    { k: "conditions", label: "提案条件", icon: ListChecks },
    { k: "qual", label: "入札資格", icon: BadgeCheck },
    { k: "team", label: "ユーザーと契約", icon: Users },
    { k: "prospect", label: "協力会社開拓", icon: Radar },
  ];

  return (
    <div className="ai-root min-h-screen bg-slate-100 text-slate-800" style={{ fontFeatureSettings: '"palt"' }}>
      <style>{`
.ai-root{overflow-x:hidden}
.ai-root *,.ai-root *::before,.ai-root *::after{box-sizing:border-box}
.ai-wrap{max-width:1280px;margin:0 auto;padding:12px}
.ai-wrap-h{max-width:1280px;margin:0 auto;padding:0 12px;height:48px;display:flex;align-items:center;gap:12px}
.ai-layout{display:block}
.ai-nav{margin-bottom:12px}
.ai-navlist{display:flex;gap:4px;overflow-x:auto;padding:0 0 4px;margin:0;list-style:none}
.ai-navlist>li{flex:0 0 auto}
.ai-main{min-width:0}
@media (min-width:900px){
  .ai-layout{display:flex;gap:12px;align-items:flex-start}
  .ai-nav{width:212px;flex:0 0 212px;margin-bottom:0;position:sticky;top:60px}
  .ai-navlist{flex-direction:column;overflow:visible;padding-bottom:0}
  .ai-navlist>li{width:100%}
  .ai-main{flex:1 1 0%;min-width:0}
}
.ai-scroll{overflow-x:auto;max-width:100%}
.ai-scroll>table{min-width:620px}
.ai-scroll-x{overflow-x:auto;max-width:100%}
.ai-panel{overflow:hidden}
.ai-hd{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;min-width:0}
.ai-hd>*{min-width:0}
.ai-cols{display:grid;gap:12px;grid-template-columns:minmax(0,1fr)}
.ai-cols>*{min-width:0}
@media (min-width:760px){
  .ai-cols-2{grid-template-columns:repeat(2,minmax(0,1fr))}
  .ai-cols-3{grid-template-columns:repeat(3,minmax(0,1fr))}
  .ai-cols-4{grid-template-columns:repeat(4,minmax(0,1fr))}
}
@media (min-width:1000px){.ai-cols-main{grid-template-columns:minmax(0,2fr) minmax(0,1fr)}}
.ai-flat{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}
@media (min-width:760px){.ai-flat{grid-template-columns:repeat(4,minmax(0,1fr))}}
.ai-fieldrow{display:grid;gap:8px;grid-template-columns:minmax(0,1fr)}
@media (min-width:700px){.ai-fieldrow{grid-template-columns:minmax(0,1fr) minmax(0,3fr)}}
.ai-w80,.ai-w72{width:100%}
@media (min-width:700px){.ai-w80{width:20rem}.ai-w72{width:18rem}}
.ai-hide-narrow{display:none}
@media (min-width:700px){.ai-hide-narrow{display:flex}}
.ai-hide-mid{display:none}
@media (min-width:900px){.ai-hide-mid{display:inline}}
.ai-root input,.ai-root textarea,.ai-root select{max-width:100%}
.ai-root td,.ai-root th{word-break:break-word}
.ai-modal{position:fixed;inset:0;display:flex;align-items:flex-end;justify-content:center;padding:12px}
@media (min-width:700px){.ai-modal{align-items:center}}
.ai-term{border-bottom:1px dotted #94a3b8;cursor:help}
.ai-step{display:grid;grid-template-columns:20px minmax(0,1fr);gap:10px;padding:10px 0;border-bottom:1px solid #f1f5f9}
.ai-step:last-child{border-bottom:0}
      `}</style>

      <header className="sticky top-0 z-20 bg-slate-800 text-slate-100">
        <div className="ai-wrap-h">
          <span className="w-6 h-6 grid place-items-center bg-white text-slate-800 rounded text-xs font-bold">入</span>
          <span className="text-sm font-semibold tracking-wide">AI入札部</span>
          <span className="text-xs text-slate-400 border border-slate-600 rounded px-1">β</span>
          <div className="ai-hide-narrow items-center gap-1.5 ml-2 text-xs text-emerald-300">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />稼働中
            <span className="text-slate-400">／収集ジョブ 07/30 04:00 完了</span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={() => setView("home")} className="text-xs px-2 py-1 rounded border border-slate-600 hover:bg-slate-700">
              承認待ち{approvals.length > 0 && <span className="ml-1 bg-amber-400 text-slate-900 rounded px-1 font-semibold">{approvals.length}</span>}
            </button>
            <span className="ai-hide-mid text-xs text-slate-300">{COMPANY.name}</span>
          </div>
        </div>
      </header>

      <div className="ai-wrap ai-layout">
        <nav className="ai-nav">
          <ul className="ai-navlist">
            {nav.map(({ k, label, icon: Icon, v2, badge }) => (
              <li key={k}>
                <button onClick={() => setView(k)}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded text-xs border whitespace-nowrap ${view === k || (k === "master" && view === "detail") ? "bg-white border-slate-300 text-slate-900 font-semibold" : "bg-transparent border-transparent text-slate-600 hover:bg-white hover:border-slate-200"}`}>
                  <Icon size={14} />{label}
                  {badge > 0 && <span className="ml-auto bg-amber-400 text-slate-900 rounded px-1 font-semibold">{badge}</span>}
                  {v2 && <span className="ml-auto text-xs text-slate-400 border border-slate-300 rounded px-1">V2</span>}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <main className="ai-main space-y-3">
          {view === "home" && <HomeView tenders={tenders} quotes={quotes} inbox={inbox} approvals={approvals} log={log}
            onOpen={open} onManual={manualRegister} onOfficial={setOfficial} onImport={setImporting} onView={setView} />}
          {view === "start" && <StartView tenders={tenders} quotes={quotes} onView={setView} onOpen={open} />}
          {view === "search" && <SearchView tenders={tenders} onOpen={open} />}
          {view === "proposals" && <ProposalsView tenders={tenders} quotes={quotes} onOpen={open} onProposal={setProposalState} onOfficial={setOfficial} />}
          {view === "replies" && <RepliesView inbox={inbox} tenders={tenders} onImport={setImporting} onOpen={open} />}
          {view === "master" && <MasterView tenders={tenders} onOpen={open} />}
          {view === "engine" && <EngineView tenders={tenders} onOpen={open} onRetry={retry} onManual={manualRegister} onParse={runParse} onPublish={publish} />}
          {view === "partners" && <PartnersView tenders={tenders} quotes={quotes} added={added} />}
          {view === "market" && <MarketView />}
          {view === "conditions" && <ConditionsView onNotify={notify} />}
          {view === "qual" && <QualView />}
          {view === "team" && <TeamView />}
          {view === "partnerside" && <PartnerSideView tenders={tenders} quotes={quotes} />}
          {view === "prospect" && <ProspectView prospects={prospects} added={added} tenders={tenders} onSend={sendProspect} onReply={replyProspect} onRegister={registerProspect} onRestore={restoreProspect} />}
          {view === "detail" && tender && (
            <Detail key={tender.id} t={tender} quotes={quotes.filter((q) => q.tid === tender.id)} inbox={inbox.filter((i) => i.tid === tender.id)}
              tab={tab} setTab={setTab} onBack={() => setView("proposals")}
              onParse={runParse} onRetry={retry} onManual={manualRegister} onOfficial={() => setOfficial(tender.id)}
              onDraft={(items, due) => setDraft({ tid: tender.id, items, due })} onRemind={remind}
              onImport={setImporting} onQuestion={sendQuestion} onForm={setForm} onPrice={decidePrice} onAward={recordAward}
              onProposal={setProposalState}
              onWork={(s) => { patch(tender.id, { work: s }); addLog(`${tender.id} の対応ステータスを「${s}」に更新`); }} />
          )}
        </main>
      </div>

      <div className="ai-wrap" style={{ paddingTop: 4, paddingBottom: 24 }}>
        <p className="text-xs text-slate-400 leading-relaxed border-t border-slate-200 pt-3">
          本サービスは、中小企業庁が運営する
          <a href="https://www.kkj.go.jp/" target="_blank" rel="noopener noreferrer" className="underline hover:text-slate-600">官公需情報ポータルサイト</a>
          のAPI、および各発注機関が公開する情報を利用しています。掲載情報の正確性・網羅性は保証されません。
          入札への参加にあたっては、必ず発注機関が公表する原本をご確認ください。
        </p>
      </div>

      {draft && <ConfirmSend draft={draft} tenders={tenders} onClose={() => setDraft(null)} onSend={send} />}
      {official && <OfficialModal t={tenders.find((x) => x.id === official)} onClose={() => setOfficial(null)} onSet={setOfficialState} />}
      {importing && <ImportModal item={importing} onClose={() => setImporting(null)} onImport={importReply} />}
      {toast && <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 bg-slate-900 text-white text-xs px-3 py-2 rounded shadow-lg">{toast}</div>}
    </div>
  );
}

/* =============================================================================
   今日やること（ホーム）
============================================================================= */
function HomeView({ tenders, quotes, inbox, approvals, log, onOpen, onManual, onOfficial, onImport, onView }) {
  const setup = setupSteps(tenders, quotes);
  const setupLeft = setup.filter((x) => !x.done);
  const active = tenders.filter((t) => t.proposal && t.proposal.state !== "対象外" && t.collect !== "終了");
  const deadlines = [];
  active.forEach((t) => {
    if (daysLeft(t.qaDeadline) >= 0) deadlines.push({ t, kind: "質問期限", at: t.qaDeadline, d: daysLeft(t.qaDeadline), tab: "qa" });
    if (daysLeft(t.submitDeadline) >= 0) deadlines.push({ t, kind: "提出期限", at: t.submitDeadline, d: daysLeft(t.submitDeadline), tab: "forms" });
    if (daysLeft(t.bidOpen) >= 0) deadlines.push({ t, kind: "開札", at: t.bidOpen, d: daysLeft(t.bidOpen), tab: "result" });
  });
  deadlines.sort((a, b) => a.d - b.d);
  const waiting = quotes.filter((q) => q.amount == null && active.some((t) => t.id === q.tid));
  const nexts = active.map((t) => {
    const qs = quotes.filter((q) => q.tid === t.id);
    const g = guideSteps(t, qs, costing(t, qs, {}));
    return { t, g };
  });

  return (
    <>
      {setupLeft.length > 0 && (
        <div className="border border-blue-200 bg-blue-50 rounded-md px-3 py-2 flex flex-wrap items-center gap-2">
          <Compass size={14} className="text-blue-800 shrink-0" />
          <p className="text-xs text-blue-900">
            初期設定があと {setupLeft.length}件 残っています（{setupLeft.map((x) => x.label).join("／")}）。
          </p>
          <button onClick={() => onView("start")} className="ml-auto text-xs text-blue-800 underline">はじめかたを見る</button>
        </div>
      )}
      <section className="ai-panel bg-white border border-slate-200 rounded-md">
        <div className="px-3 py-2 border-b border-slate-200 flex items-center gap-2">
          <Bot size={15} className="text-blue-800" />
          <h2 className="text-xs font-semibold text-slate-700">今日やること</h2>
          <span className="text-xs text-slate-400">2026/07/30（木）</span>
        </div>
        <div className="p-3">
          <p className="text-xs text-slate-700 leading-relaxed">
            AIが昨夜のうちに公告19件を集めて解析し、参加できる案件を{active.length}件お届けしました。
            あなたの操作が必要なのは <span className="font-semibold">{approvals.length + inbox.length}件</span> です。
            画面の順番どおりに進めれば提出まで終わります。
          </p>
          <div className="ai-flat mt-3 border border-slate-200 rounded divide-x divide-slate-100">
            {[
              { l: "承認待ち", v: approvals.length, go: null },
              { l: "未取込の返信", v: inbox.length, go: "replies" },
              { l: "未回答の見積", v: waiting.length, go: null },
              { l: "3日以内の期限", v: deadlines.filter((x) => x.d <= 3).length, go: null },
            ].map((s) => (
              <button key={s.l} onClick={() => s.go && onView(s.go)} className="px-3 py-2 text-left">
                <div className="text-xs text-slate-500">{s.l}</div>
                <div className={`text-lg font-semibold tabular-nums ${s.v > 0 ? "text-slate-900" : "text-slate-300"}`}>{s.v}</div>
              </button>
            ))}
          </div>
        </div>
      </section>

      <div className="ai-cols ai-cols-main">
        <div className="space-y-3">
          <Panel title={`あなたの承認が必要（${approvals.length}）`}>
            {approvals.length === 0 ? <p className="text-xs text-slate-500">ありません。</p> : (
              <ul className="space-y-2">
                {approvals.map((a) => {
                  const t = tenders.find((x) => x.id === a.tid);
                  return (
                    <li key={a.id} className="border border-slate-200 rounded p-2.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <Pill tone={a.type === "見積依頼" ? "blue" : a.type === "質問送信" ? "violet" : "amber"}>{a.type}</Pill>
                        <button onClick={() => onOpen(a.tid)} className="text-xs font-semibold hover:underline">{t?.name}</button>
                      </div>
                      <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">{a.note}</p>
                      <div className="flex flex-wrap gap-2 mt-2">
                        {a.type === "見積依頼" && <Btn kind="primary" onClick={() => onOpen(a.tid, "request")}><Send size={12} />内容を確認する</Btn>}
                        {a.type === "質問送信" && <Btn kind="primary" onClick={() => onOpen(a.tid, "qa")}><HelpCircle size={12} />質問案を見る</Btn>}
                        {a.type === "手動登録" && <Btn kind="primary" onClick={() => onManual(a.tid)}><Inbox size={12} />資料を手動登録する</Btn>}
                        <Btn onClick={() => onOpen(a.tid)}>案件を開く</Btn>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>

          <Panel title="進行中の案件と次の一手" dense>
            <ul className="divide-y divide-slate-100">
              {nexts.map(({ t, g }) => (
                <li key={t.id} className="p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <button onClick={() => onOpen(t.id)} className="text-xs font-semibold hover:underline">{t.name}</button>
                    <WorkPill s={t.work} />
                    <span className="ml-auto text-xs text-slate-500 tabular-nums">{g.done}/{g.steps.length} 完了</span>
                  </div>
                  <div className="mt-1.5"><Bar v={(g.done / g.steps.length) * 100} tone="bg-emerald-500" /></div>
                  {g.next && (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Pill tone="blue"><ArrowRight size={11} />次：{g.next.label}</Pill>
                      <span className="text-xs text-slate-500">{g.next.you ?? "AIが処理中"}</span>
                      <Btn size="sm" onClick={() => onOpen(t.id, g.next.tab)}>進める</Btn>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </Panel>

          {inbox.length > 0 && (
            <Panel title={`協力会社からの返信（未取込 ${inbox.length}）`} right={<Btn size="sm" onClick={() => onView("replies")}>すべて見る</Btn>}>
              <ul className="space-y-2">
                {inbox.map((i) => (
                  <li key={i.id} className="border border-slate-200 rounded p-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Ch ch={i.via} /><span className="text-xs font-semibold">{partnerById(i.cid).name}</span>
                      <Pill>{i.trade}</Pill>
                      {i.amount != null ? <Pill tone="green">金額を検出 {yen(i.amount)}</Pill> : <Pill tone="amber">金額なし</Pill>}
                    </div>
                    <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">{i.text}</p>
                    <div className="mt-2"><Btn size="sm" kind="primary" onClick={() => onImport(i)}><Download size={12} />見積に取り込む</Btn></div>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>

        <div className="space-y-3">
          <Panel title="期限ボード" right={<span className="text-xs text-slate-400">近い順</span>}>
            <ul className="space-y-2">
              {deadlines.slice(0, 8).map((x, i) => (
                <li key={i} className="flex flex-wrap items-center gap-2">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${x.d <= 2 ? "bg-rose-500" : x.d <= 5 ? "bg-amber-500" : "bg-slate-300"}`} />
                  <Pill tone={x.kind === "質問期限" ? "violet" : x.kind === "提出期限" ? "blue" : "slate"}>{x.kind}</Pill>
                  <button onClick={() => onOpen(x.t.id, x.tab)} className="text-xs hover:underline truncate">{x.t.name}</button>
                  <span className={`ml-auto text-xs tabular-nums ${x.d <= 2 ? "text-rose-700 font-semibold" : "text-slate-500"}`}>残{x.d}日</span>
                </li>
              ))}
            </ul>
          </Panel>
          <Panel title="AIの稼働ログ">
            <ol className="space-y-2.5">
              {log.slice(-8).map((l, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-xs text-slate-400 tabular-nums w-14 shrink-0">{l.t}</span>
                  <span className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${l.kind === "warn" ? "bg-amber-500" : l.kind === "ai" ? "bg-blue-700" : "bg-emerald-500"}`} />
                  <span className="text-xs text-slate-700 leading-relaxed">{l.text}</span>
                </li>
              ))}
            </ol>
          </Panel>
        </div>
      </div>
    </>
  );
}

/* =============================================================================
   提案された案件
============================================================================= */
function ProposalsView({ tenders, quotes, onOpen, onProposal, onOfficial }) {
  const rows = tenders.filter((t) => t.proposal && t.proposal.state !== "対象外" && t.collect !== "終了")
    .map((t) => ({ t, f: evaluateFit(t) })).sort((a, b) => b.f.score - a.f.score);
  const excluded = tenders.filter((t) => t.proposal?.state === "対象外");
  return (
    <div className="space-y-3">
      <Panel title="照合条件">
        <p className="text-xs text-slate-600 leading-relaxed">
          {COMPANY.name}／<Term w="全省庁統一資格" /> {COMPANY.quals.join("・")}／<Term w="等級" /> {Object.entries(COMPANY.grades).map(([k, v]) => `${k} ${v}`).join("・")}／
          <Term w="営業品目" /> {COMPANY.items.join("・")}／<Term w="競争参加地域" /> {COMPANY.areas.join("・")}
        </p>
      </Panel>

      {rows.map(({ t, f }) => {
        const g = guideSteps(t, quotes.filter((q) => q.tid === t.id), null);
        return (
          <Panel key={t.id}>
            <div className="flex flex-wrap items-start gap-3">
              <div className="min-w-0 flex-1">
                <button onClick={() => onOpen(t.id)} className="text-sm font-semibold text-left hover:underline leading-snug">{t.name}</button>
                <div className="text-xs text-slate-500 mt-0.5">{t.agency}／{t.org}</div>
                <div className="flex flex-wrap gap-1 mt-2">
                  <Verdict v={f.verdict} /><ProposePill s={t.proposal.state} /><Pill>{t.item}</Pill><Pill>{t.grade}</Pill>
                  <Pill tone="blue">提出まで残{f.dl}日</Pill>
                </div>
              </div>
              <div className="ai-w80" style={{ maxWidth: 220 }}>
                <div className="flex items-baseline gap-1">
                  <span className="text-2xl font-semibold tabular-nums">{f.score}</span><span className="text-xs text-slate-500">% 適合</span>
                </div>
                <Bar v={f.score} tone={f.verdict === "条件不足" ? "bg-rose-500" : f.verdict === "要確認" ? "bg-amber-500" : "bg-emerald-500"} />
                <div className="text-xs text-slate-500 mt-1">手順 {g.done}/{g.steps.length} 完了</div>
              </div>
            </div>
            <div className="ai-cols ai-cols-2 mt-3">
              <div>
                <div className="text-xs font-semibold text-slate-700">参加できる理由</div>
                <ul className="mt-1 space-y-1">{f.ok.map((r) => <li key={r} className="text-xs text-slate-700 flex gap-1.5"><CheckCircle2 size={12} className="text-emerald-600 mt-0.5 shrink-0" />{r}</li>)}</ul>
              </div>
              <div>
                <div className="text-xs font-semibold text-slate-700">確認が必要な点</div>
                {f.ng.length === 0 && f.unknown.length === 0 ? <p className="text-xs text-slate-400 mt-1">なし</p> : (
                  <ul className="mt-1 space-y-1">
                    {f.ng.map((r) => <li key={r} className="text-xs text-slate-700 flex gap-1.5"><AlertTriangle size={12} className="text-amber-600 mt-0.5 shrink-0" />{r}</li>)}
                    {f.unknown.map((r) => <li key={r} className="text-xs text-slate-500 flex gap-1.5"><HelpCircle size={12} className="text-slate-400 mt-0.5 shrink-0" />{r}</li>)}
                  </ul>
                )}
              </div>
            </div>
            <div className="flex flex-wrap gap-2 mt-3">
              <Btn kind="primary" onClick={() => onOpen(t.id, "guide")}><ListChecks size={12} />進め方を見る</Btn>
              {t.proposal.state !== "検討中" && <Btn onClick={() => { onProposal(t.id, "検討中"); onOfficial(t.id); }}><Download size={12} />参加を検討する</Btn>}
              <Btn onClick={() => onProposal(t.id, "対象外")}>今回は見送る</Btn>
            </div>
          </Panel>
        );
      })}

      {excluded.length > 0 && (
        <Panel title={`対象外（${excluded.length}）`}>
          <ul className="space-y-1.5">
            {excluded.map((t) => (
              <li key={t.id} className="text-xs flex flex-wrap gap-2">
                <button onClick={() => onOpen(t.id)} className="font-medium hover:underline">{t.name}</button>
                <span className="text-slate-500">{t.proposal.reason ?? "手動で見送り"}</span>
                <button onClick={() => onProposal(t.id, "提案対象")} className="text-blue-800 underline ml-auto">戻す</button>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}

/* =============================================================================
   見積の返信（受信箱）
============================================================================= */
function RepliesView({ inbox, tenders, onImport, onOpen }) {
  return (
    <div className="space-y-3">
      <Panel title="協力会社からの返信">
        <p className="text-xs text-slate-600 leading-relaxed">
          見積依頼を送ったLINE・メールの返信をAIが読み取り、金額を抽出します。金額が読み取れない返信（下見の依頼・辞退など）もここに残るので、取りこぼしません。
        </p>
      </Panel>
      {inbox.length === 0 ? (
        <Panel><p className="text-xs text-slate-500">未取込の返信はありません。</p></Panel>
      ) : inbox.map((i) => {
        const t = tenders.find((x) => x.id === i.tid);
        return (
          <Panel key={i.id}>
            <div className="flex flex-wrap items-center gap-2">
              <Ch ch={i.via} />
              <span className="text-xs font-semibold">{partnerById(i.cid).name}</span>
              <Pill>{i.trade}</Pill>
              <span className="text-xs text-slate-500">{i.at}</span>
              <button onClick={() => onOpen(i.tid, "compare")} className="text-xs text-blue-800 underline ml-auto">{t?.name}</button>
            </div>
            <p className="text-xs text-slate-700 mt-2 leading-relaxed border-l-2 border-slate-200 pl-2">{i.text}</p>
            <div className="flex flex-wrap items-center gap-2 mt-2">
              {i.amount != null
                ? <Pill tone="green"><Sparkles size={11} />AIが金額を検出：{yen(i.amount)}</Pill>
                : <Pill tone="amber">金額が読み取れませんでした（手入力が必要）</Pill>}
              <Btn size="sm" kind="primary" onClick={() => onImport(i)}><Download size={12} />見積に取り込む</Btn>
            </div>
          </Panel>
        );
      })}
    </div>
  );
}

function ImportModal({ item, onClose, onImport }) {
  const [amount, setAmount] = useState(item.amount ?? "");
  return (
    <div className="ai-modal z-30" style={{ backgroundColor: "rgba(15,23,42,0.5)" }}>
      <div className="bg-white rounded-md border border-slate-200 w-full max-w-md">
        <div className="ai-hd px-3 py-2 border-b border-slate-200">
          <h2 className="text-xs font-semibold">返信を見積として取り込む</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X size={16} /></button>
        </div>
        <div className="p-3 space-y-3">
          <dl>
            <Field label="協力会社">{partnerById(item.cid).name}</Field>
            <Field label="業種">{item.trade}</Field>
            <Field label="受信">{item.via}／{item.at}</Field>
          </dl>
          <p className="text-xs text-slate-600 border-l-2 border-slate-200 pl-2 leading-relaxed">{item.text}</p>
          <label className="block text-xs">
            <span className="text-slate-500">見積金額（税抜）</span>
            <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="金額を入力"
              className="mt-1 w-full text-xs border border-slate-300 rounded px-2 py-1.5 tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-300" />
          </label>
          {item.amount == null && <p className="text-xs text-amber-700">この返信には金額が書かれていません。下見依頼や辞退の可能性があります。</p>}
        </div>
        <div className="px-3 py-2 border-t border-slate-200 flex gap-2 justify-end">
          <Btn onClick={onClose}>閉じる</Btn>
          <Btn kind="primary" disabled={!amount} onClick={() => onImport(item, Number(amount))}>取り込む</Btn>
        </div>
      </div>
    </div>
  );
}

/* =============================================================================
   案件詳細
============================================================================= */
function Detail({ t, quotes, inbox, tab, setTab, onBack, onParse, onRetry, onManual, onOfficial, onDraft, onRemind, onImport, onQuestion, onForm, onPrice, onAward, onProposal, onWork }) {
  const f = evaluateFit(t);
  const [picks, setPicks] = useState({});
  const cost = costing(t, quotes, picks);
  const g = guideSteps(t, quotes, cost);
  const got = t.docs.filter((x) => x.got).length;
  const tabs = [
    { k: "guide", label: "進め方", icon: ListChecks },
    { k: "fit", label: "参加判断", icon: Target },
    { k: "docs", label: `資料（${got}/${t.docs.length}）`, icon: FileText },
    { k: "analysis", label: "公告の中身", icon: Sparkles },
    { k: "qa", label: `質問（${(t.questions ?? []).length}）`, icon: HelpCircle },
    { k: "request", label: "見積依頼", icon: Send },
    { k: "compare", label: `見積・原価（${quotes.filter((q) => q.amount != null).length}/${quotes.length}）`, icon: Calculator },
    { k: "forms", label: `提出書類（${(t.forms ?? []).filter((x) => x.state === "完了").length}/${(t.forms ?? []).length}）`, icon: ClipboardCheck },
    { k: "result", label: "結果", icon: Award },
  ];
  return (
    <>
      <div className="flex items-center gap-2 text-xs">
        <Btn kind="ghost" onClick={onBack}>← 一覧へ</Btn><span className="text-slate-400 tabular-nums">{t.id}</span>
      </div>

      <Panel>
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-sm font-semibold leading-snug">{t.name}</h1>
            <div className="text-xs text-slate-500 mt-1">{t.agency}／{t.org}／公告番号 {t.noticeNo}</div>
            <div className="flex flex-wrap gap-1 mt-2">
              {t.analysis && <Verdict v={f.verdict} />}
              {t.analysis && <Pill tone="blue">適合率 {f.score}%</Pill>}
              <CollectPill s={t.collect} /><ProposePill s={t.proposal?.state} /><WorkPill s={t.work} />
            </div>
            {(() => {
              const miss = t.docs.filter((x) => !x.got && !x.absent);
              if (miss.length === 0 && f.unknown.length === 0) return null;
              return (
                <p className="text-xs text-amber-800 mt-2 flex gap-1.5 items-start">
                  <HelpCircle size={12} className="mt-0.5 shrink-0" />
                  <span>
                    この案件には未確定の項目があります
                    {miss.length > 0 && <>（{miss.map((x) => x.kind).join("・")}が取得できていません）</>}。
                    判定できない項目は推測せず「未判定」と表示しています。
                  </span>
                </p>
              );
            })()}
          </div>
          <dl className="text-xs ai-w80">
            <Field label={<Term w="予定価格" />}>{yen(t.budget)}</Field>
            <Field label={<Term w="質問期限" />}><Due s={t.qaDeadline} /></Field>
            <Field label="提出期限"><Due s={t.submitDeadline} /></Field>
            <Field label={<Term w="開札" />}><Due s={t.bidOpen} /></Field>
            <Field label="履行期間">{t.termFrom} 〜 {t.termTo}</Field>
          </dl>
        </div>
      </Panel>

      <div className="ai-scroll-x flex gap-1">
        {tabs.map(({ k, label, icon: Icon }) => (
          <button key={k} onClick={() => setTab(k)}
            className={`shrink-0 inline-flex items-center gap-1.5 text-xs px-3 py-2 rounded-t border-b-2 ${tab === k ? "border-blue-800 text-slate-900 font-semibold bg-white" : "border-transparent text-slate-500 hover:bg-white"}`}>
            <Icon size={13} />{label}
          </button>
        ))}
      </div>

      {tab === "guide" && <GuideTab key={t.id} t={t} g={g} setTab={setTab} onProposal={onProposal} onOfficial={onOfficial} onWork={onWork} />}
      {tab === "fit" && <FitTab key={t.id} t={t} f={f} />}
      {tab === "docs" && <DocsTab key={t.id} t={t} onRetry={onRetry} onManual={onManual} onOfficial={onOfficial} />}
      {tab === "analysis" && <AnalysisTab key={t.id} t={t} onParse={onParse} />}
      {tab === "qa" && <QaTab key={t.id} t={t} onQuestion={onQuestion} />}
      {tab === "request" && <RequestTab key={t.id} t={t} quotes={quotes} onDraft={onDraft} />}
      {tab === "compare" && <CompareTab key={t.id} t={t} quotes={quotes} inbox={inbox} cost={cost} picks={picks} setPicks={setPicks} onRemind={onRemind} onImport={onImport} onPrice={onPrice} onGo={() => setTab("request")} />}
      {tab === "forms" && <FormsTab key={t.id} t={t} onForm={onForm} onWork={onWork} />}
      {tab === "result" && <ResultTab key={t.id} t={t} onAward={onAward} />}
    </>
  );
}

/* ── 進め方（素人向けの中心画面） ────────────────────────────────────────── */
function GuideTab({ t, g, setTab, onProposal, onOfficial, onWork }) {
  return (
    <div className="space-y-3">
      <Panel title="この案件の進め方" right={<span className="text-xs text-slate-500 tabular-nums">{g.done}/{g.steps.length} 完了</span>}>
        <Bar v={(g.done / g.steps.length) * 100} tone="bg-emerald-500" />
        {g.next && (
          <div className="mt-3 border border-blue-200 bg-blue-50 rounded p-2.5">
            <div className="text-xs font-semibold text-blue-900 flex items-center gap-1.5"><ArrowRight size={13} />次にやること：{g.next.label}</div>
            <p className="text-xs text-blue-900 mt-1 leading-relaxed">{g.next.why}</p>
            <div className="flex flex-wrap gap-2 mt-2">
              <Btn kind="primary" onClick={() => setTab(g.next.tab)}>この作業を開く</Btn>
              {g.next.due && <span className="text-xs self-center"><Due s={g.next.due} label="期限" /></span>}
            </div>
          </div>
        )}
      </Panel>

      <Panel dense>
        <div className="p-3">
          {g.steps.map((s, i) => (
            <div key={s.key} className="ai-step">
              <div className="pt-0.5">
                {s.done ? <CheckCircle2 size={16} className="text-emerald-600" />
                  : s.active ? <span className="inline-block w-4 h-4 rounded-full border-2 border-blue-700" />
                  : <Circle size={16} className="text-slate-300" />}
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`text-xs font-semibold ${s.done ? "text-slate-500" : "text-slate-900"}`}>{i + 1}. {s.label}</span>
                  {s.done && <Pill tone="green">完了</Pill>}
                  {!s.done && s.active && <Pill tone="blue">いまここ</Pill>}
                  {s.due && !s.done && <span className="ml-auto"><Due s={s.due} /></span>}
                </div>
                <p className="text-xs text-slate-500 mt-1 leading-relaxed">{s.why}</p>
                <div className="flex flex-wrap gap-2 mt-1.5">
                  {s.ai && <Pill tone="violet"><Bot size={11} />AI：{s.ai}</Pill>}
                  {s.you && <Pill tone="amber">あなた：{s.you}</Pill>}
                  {s.tab && <button onClick={() => setTab(s.tab)} className="text-xs text-blue-800 underline">開く</button>}
                </div>
              </div>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="対応ステータス">
        <Stepper list={WORK} current={t.work} />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select value={t.work} onChange={(e) => onWork(e.target.value)} className="text-xs border border-slate-300 rounded px-2 py-1 bg-white">
            {WORK.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <span className="text-xs text-slate-400">通常は各作業を進めると自動で切り替わります</span>
        </div>
      </Panel>
    </div>
  );
}

/* ── 参加判断 ─────────────────────────────────────────────────────────────── */
function FitTab({ t, f }) {
  if (!t.analysis) return <Panel title="参加判断"><p className="text-xs text-slate-600">AI解析が終わると判定します。{t.failure ? `（現在：${t.failure.reason}）` : ""}</p></Panel>;
  return (
    <div className="ai-cols ai-cols-3">
      <Panel title="適合率">
        <div className="flex items-baseline gap-1"><span className="text-3xl font-semibold tabular-nums">{f.score}</span><span className="text-xs text-slate-500">/ 100</span></div>
        <div className="mt-2"><Bar v={f.score} tone={f.verdict === "条件不足" ? "bg-rose-500" : f.verdict === "要確認" ? "bg-amber-500" : "bg-emerald-500"} /></div>
        <div className="mt-2"><Verdict v={f.verdict} /></div>
        <p className="text-xs text-slate-500 mt-3 leading-relaxed">配点：資格20／品目20／等級15／地域15／金額10／残日数10／協力会社10</p>
      </Panel>
      <Panel title="参加できる理由">
        <ul className="space-y-1.5">{f.ok.map((r) => <li key={r} className="text-xs text-slate-700 flex gap-1.5"><CheckCircle2 size={12} className="text-emerald-600 mt-0.5 shrink-0" />{r}</li>)}</ul>
      </Panel>
      <Panel title="確認が必要な点">
        {f.ng.length === 0 && f.unknown.length === 0 ? <p className="text-xs text-slate-400">なし</p> : (
          <ul className="space-y-1.5">
            {f.ng.map((r) => <li key={r} className="text-xs text-slate-700 flex gap-1.5"><AlertTriangle size={12} className="text-amber-600 mt-0.5 shrink-0" />{r}</li>)}
            {f.unknown.map((r) => (
              <li key={r} className="text-xs text-slate-600 flex gap-1.5"><HelpCircle size={12} className="text-slate-400 mt-0.5 shrink-0" />
                <span>{r}<br /><span className="text-slate-400">推測せず未判定として扱っています。</span></span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

/* ── 資料 ─────────────────────────────────────────────────────────────────── */
function DocsTab({ t, onRetry, onManual, onOfficial }) {
  const got = t.docs.filter((x) => x.got).length;
  const absent = t.docs.filter((x) => !x.got && x.absent).length;
  const missing = t.docs.filter((x) => !x.got && !x.absent).length;
  return (
    <div className="space-y-3">
      <div className="ai-cols ai-cols-3">
        <Panel title="本部による取得">
          <div className="flex flex-wrap items-center gap-2">
            {missing === 0 ? <Pill tone="green">取得できるものは揃っています</Pill> : <Pill tone="amber">取得できていない資料が{missing}件</Pill>}
            <span className="text-xs text-slate-500">{t.via}</span>
          </div>
          <div className="mt-2"><Bar v={((got + absent) / t.docs.length) * 100} tone={missing === 0 ? "bg-emerald-500" : "bg-amber-500"} /></div>
          <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">
            取得済 {got}件{absent > 0 && <>／この案件には提供がない資料 {absent}件</>}{missing > 0 && <>／<span className="text-rose-700 font-semibold">取得できていない資料 {missing}件</span></>}
          </p>
          <p className="text-xs text-slate-400 mt-1">AI解析のための取得です</p>
        </Panel>
        <Panel title="AI解析">
          {t.parse === "完了" ? <Pill tone="violet">完了</Pill> : t.parse === "処理中" ? <Pill tone="amber">処理中</Pill> : <Pill tone="rose">未実施</Pill>}
          <p className="text-xs text-slate-500 mt-2">解析結果は案件マスタに保存されます</p>
        </Panel>
        <Panel title="御社による正式取得">
          {t.official.state === "取得済" ? <Pill tone="green">取得済</Pill> : t.official.state === "申請中" ? <Pill tone="amber">申請中</Pill> : <Pill tone="rose">未取得</Pill>}
          <p className="text-xs text-slate-500 mt-2 leading-relaxed">{t.official.how}</p>
          <div className="mt-2"><Btn size="sm" kind="primary" onClick={onOfficial}><Download size={12} />手順を開く</Btn></div>
        </Panel>
      </div>

      <div className="border border-amber-200 bg-amber-50 rounded-md px-3 py-2 flex items-start gap-2">
        <AlertTriangle size={14} className="text-amber-700 mt-0.5 shrink-0" />
        <p className="text-xs text-amber-900">
          本部が取得した資料は、AIが解析するためのものです。入札に参加するには、<Term w="入札説明書" />等を<span className="font-semibold">御社の名義で</span>取得する必要があります。
        </p>
      </div>
      {missing > 0 && (
        <div className="border border-rose-200 bg-rose-50 rounded-md px-3 py-2 flex items-start gap-2">
          <AlertOctagon size={14} className="text-rose-700 mt-0.5 shrink-0" />
          <p className="text-xs text-rose-900">
            取得できていない資料が{missing}件あります。{t.docs.filter((x) => !x.got && !x.absent).map((x) => x.kind).join("・")}が未取得のため、
            この案件の判定には未確定の項目が含まれます。管理者が手動で取得します。
          </p>
        </div>
      )}

      <Panel title="取得済みの資料" dense right={<span className="text-xs text-slate-400">取得元：{t.via}</span>}>
        <div className="ai-scroll">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-500"><tr className="text-left">
              <th className="px-3 py-2 font-medium">種別</th><th className="px-2 py-2 font-medium">取得</th>
              <th className="px-2 py-2 font-medium">取得日時</th><th className="px-2 py-2 font-medium">ファイル</th><th className="px-2 py-2" />
            </tr></thead>
            <tbody>
              {t.docs.map((x) => (
                <tr key={x.kind} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-medium">{x.kind === "数量表" ? <Term w="数量表" /> : x.kind === "入札説明書" ? <Term w="入札説明書" /> : x.kind}</td>
                  <td className="px-2 py-2">
                    {x.got ? <Pill tone="green">取得済</Pill>
                      : x.absent ? <Pill>この案件には提供がありません</Pill>
                      : <Pill tone="rose">取得できていません</Pill>}
                  </td>
                  <td className="px-2 py-2 tabular-nums text-slate-600">{x.at ?? "—"}</td>
                  <td className="px-2 py-2 text-slate-600">{x.src ?? "—"}</td>
                  <td className="px-2 py-2 text-right">{x.got ? <Btn size="sm">開く</Btn> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-3 py-2 border-t border-slate-200 text-xs text-slate-500">公告元URL：<span className="text-slate-700 break-all">{t.url}</span></div>
      </Panel>

      {t.lots?.length > 0 && (
        <Panel title="数量表（業種を自動で割当）" dense right={<span className="text-xs text-slate-400">見積依頼のときに業種ごとに切り出します</span>}>
          <div className="ai-scroll">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-500"><tr className="text-left">
                <th className="px-3 py-2 font-medium">No</th><th className="px-2 py-2 font-medium">項目</th>
                <th className="px-2 py-2 font-medium">仕様</th><th className="px-2 py-2 font-medium text-right">数量</th>
                <th className="px-2 py-2 font-medium">割当業種</th>
              </tr></thead>
              <tbody>
                {t.lots.map((l) => (
                  <tr key={l.no} className="border-t border-slate-100">
                    <td className="px-3 py-2 tabular-nums text-slate-400">{l.no}</td>
                    <td className="px-2 py-2 font-medium">{l.item}</td>
                    <td className="px-2 py-2 text-slate-600">{l.spec}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{l.qty} {l.unit}</td>
                    <td className="px-2 py-2"><Pill tone="blue">{l.trade}</Pill></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {t.failure && (
        <Panel title="取得失敗">
          <p className="text-xs text-rose-700 flex gap-1.5"><AlertOctagon size={13} className="mt-0.5 shrink-0" />{t.failure.reason}</p>
          <div className="flex gap-2 mt-2">
            {t.via !== "FAX交付" && <Btn onClick={() => onRetry(t.id)}><RefreshCw size={12} />再取得する</Btn>}
            <Btn kind="primary" onClick={() => onManual(t.id)}><Inbox size={12} />資料を手動登録する</Btn>
          </div>
        </Panel>
      )}
    </div>
  );
}

/* ── 公告の中身 ───────────────────────────────────────────────────────────── */
function AnalysisTab({ t, onParse }) {
  if (!t.analysis) return (
    <Panel title="公告の中身">
      <div className="text-center py-8">
        <p className="text-xs text-slate-600">まだ解析していません。</p>
        {t.failure && <p className="text-xs text-slate-400 mt-1">{t.failure.reason}</p>}
        {!t.failure && <div className="mt-3"><Btn kind="primary" onClick={() => onParse(t.id)}><RefreshCw size={12} />解析する</Btn></div>}
      </div>
    </Panel>
  );
  const a = t.analysis;
  return (
    <div className="ai-cols ai-cols-main">
      <div className="space-y-3">
        <Panel title="AIによる要約" right={<span className="text-xs text-slate-400">出典：{t.docs.filter((x) => x.got).map((x) => x.kind).join("・")}</span>}>
          <p className="text-xs leading-relaxed text-slate-700">{a.summary}</p>
          <dl className="mt-2">
            <Field label="参加資格"><ul className="space-y-0.5">{a.quals.map((q) => <li key={q}>・{q}</li>)}</ul></Field>
            <Field label="営業品目・等級">{t.item}／{t.grade}</Field>
            <Field label="競争参加地域">{t.areas.join("・")}</Field>
            <Field label="履行場所">{t.place}</Field>
            <Field label="参加条件"><ul className="space-y-0.5">{a.conditions.map((c) => <li key={c}>・{c}</li>)}</ul></Field>
            <Field label="正式取得の方法">{a.official}</Field>
          </dl>
        </Panel>
        {a.notes.length > 0 && (
          <Panel title="見落としやすい注意点">
            <ul className="space-y-1.5">{a.notes.map((n) => (
              <li key={n} className="flex gap-2 text-xs text-slate-700"><AlertTriangle size={13} className="text-amber-600 shrink-0 mt-0.5" />{n}</li>
            ))}</ul>
          </Panel>
        )}
      </div>
      <div className="space-y-3">
        <Panel title="必要な協力業種">
          {a.trades.length === 0 ? <p className="text-xs text-slate-500">対象なし</p> : (
            <ul className="space-y-2">{a.trades.map((x) => (
              <li key={x.trade}>
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-semibold ${x.skip ? "text-slate-400 line-through" : ""}`}>{x.trade}</span>
                  <span className="text-xs text-slate-400 tabular-nums ml-auto">確度 {x.conf}%</span>
                </div>
                <div className="mt-1"><Bar v={x.conf} tone={x.skip ? "bg-slate-300" : "bg-blue-700"} /></div>
                <p className="text-xs text-slate-500 mt-1 leading-relaxed">根拠：{x.evidence}</p>
              </li>
            ))}</ul>
          )}
        </Panel>
      </div>
    </div>
  );
}

/* ── 質問 ─────────────────────────────────────────────────────────────────── */
function QaTab({ t, onQuestion }) {
  const dl = daysLeft(t.qaDeadline);
  return (
    <div className="space-y-3">
      <Panel title="発注機関への質問">
        <p className="text-xs text-slate-600 leading-relaxed">
          公告や仕様書で条件が曖昧な箇所をAIが探し、質問案を作りました。<Term w="質問期限" />を過ぎると聞けなくなるため、送るかどうかだけ決めてください。
        </p>
        <div className="mt-2"><Due s={t.qaDeadline} label="質問期限" /></div>
        {dl < 0 && <p className="text-xs text-rose-700 mt-1">質問期限は終了しています。</p>}
      </Panel>
      {(t.questions ?? []).length === 0 ? (
        <Panel><p className="text-xs text-slate-500">この案件では曖昧な条件は見つかりませんでした。</p></Panel>
      ) : t.questions.map((q) => (
        <Panel key={q.id}>
          <div className="flex flex-wrap items-center gap-2">
            {q.status === "送信済" ? <Pill tone="green">送信済</Pill> : <Pill tone="amber">下書き</Pill>}
            <span className="text-xs text-slate-500">{q.basis}</span>
          </div>
          <p className="text-xs text-slate-800 mt-2 leading-relaxed border-l-2 border-slate-200 pl-2">{q.text}</p>
          {q.status === "下書き" && dl >= 0 && (
            <div className="mt-2 flex gap-2">
              <Btn kind="primary" onClick={() => onQuestion(t.id, q.id)}><Send size={12} />この内容で送信する</Btn>
              <Btn>編集する</Btn>
            </div>
          )}
          {q.status === "送信済" && <p className="text-xs text-slate-500 mt-2">回答が届くと、この案件の注意事項に自動で追記されます。</p>}
        </Panel>
      ))}
    </div>
  );
}

/* ── 見積依頼 ─────────────────────────────────────────────────────────────── */
function RequestTab({ t, quotes, onDraft }) {
  const plan = (t.analysis?.trades ?? []).filter((x) => !x.skip);
  const already = (trade, cid) => quotes.some((q) => q.trade === trade && q.cid === cid);
  const initial = useMemo(() => {
    const s = {};
    plan.forEach((x) => { s[x.trade] = recommendFor(x.trade, t).slice(0, 2).filter((c) => !already(x.trade, c.id)).map((c) => c.id); });
    return s;
  }, [t.id]);
  const [sel, setSel] = useState(initial);
  const [due, setDue] = useState("2026/08/04 17:00");
  const [msg, setMsg] = useState(
    `${t.name}の見積をお願いします。\n発注機関：${t.agency}\n履行場所：${t.place}\n履行期間：${t.termFrom}〜${t.termTo}\n【回答期限】下記の期限までにご返信ください。\n数量表のうち、御社の担当分だけを抜き出して添付しています。対応できない場合はその旨だけご返信ください。`
  );
  const toggle = (trade, cid) => setSel((s) => {
    const cur = s[trade] || [];
    return { ...s, [trade]: cur.includes(cid) ? cur.filter((x) => x !== cid) : [...cur, cid] };
  });
  const items = plan.map((x) => ({ trade: x.trade, ids: sel[x.trade] || [] })).filter((i) => i.ids.length > 0);
  const total = items.reduce((n, i) => n + i.ids.length, 0);
  if (plan.length === 0) return <Panel title="見積依頼"><p className="text-xs text-slate-600">解析で必要な協力業種が決まると、依頼先を提案します。</p></Panel>;

  return (
    <div className="ai-cols ai-cols-main">
      <div className="space-y-3">
        <Panel title="AIが選んだ依頼先と、送る資料">
          <div className="space-y-3">
            {plan.map((x) => {
              const cands = recommendFor(x.trade, t);
              const lots = (t.lots ?? []).filter((l) => l.trade === x.trade);
              return (
                <div key={x.trade} className="border border-slate-200 rounded">
                  <div className="ai-hd px-2.5 py-1.5 bg-slate-50 border-b border-slate-200">
                    <span className="text-xs font-semibold">{x.trade}<span className="text-slate-500 font-normal ml-2">確度 {x.conf}%</span></span>
                    <span className="text-xs text-slate-500 tabular-nums">選択 {(sel[x.trade] || []).length}／{cands.length}社</span>
                  </div>
                  {lots.length > 0 && (
                    <div className="px-2.5 py-2 border-b border-slate-100 bg-white">
                      <div className="text-xs text-slate-500 mb-1">この業種に送る数量表（{lots.length}行だけを切り出して添付）</div>
                      <ul className="space-y-0.5">
                        {lots.map((l) => (
                          <li key={l.no} className="text-xs text-slate-700 flex gap-2">
                            <span className="text-slate-400 tabular-nums w-5">{l.no}</span>
                            <span className="flex-1 min-w-0">{l.item}<span className="text-slate-400">／{l.spec}</span></span>
                            <span className="tabular-nums shrink-0">{l.qty} {l.unit}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {cands.length === 0 ? <p className="text-xs text-rose-700 px-2.5 py-2">この業種の登録会社がありません（協力会社開拓の対象）</p> : (
                    <div className="ai-scroll"><table className="w-full text-xs"><tbody>
                      {cands.map((c, i) => {
                        const sent = already(x.trade, c.id);
                        const on = (sel[x.trade] || []).includes(c.id);
                        return (
                          <tr key={c.id} className="border-t border-slate-100">
                            <td className="pl-2.5 py-2 w-6"><input type="checkbox" checked={on} disabled={sent} onChange={() => toggle(x.trade, c.id)} className="align-middle accent-blue-800" /></td>
                            <td className="py-2">
                              <div className="flex items-center gap-1.5">
                                <span className="font-medium">{c.name}</span>
                                {i === 0 && <Pill tone="blue"><Sparkles size={10} />おすすめ</Pill>}
                                {sent && <Pill>依頼済</Pill>}
                              </div>
                              <div className="text-slate-500">{reasonFor(c, t)}</div>
                            </td>
                            <td className="py-2 text-right text-slate-500 tabular-nums whitespace-nowrap">採用 {Math.round(c.adopt * 100)}%／{c.resp}h</td>
                            <td className="py-2 pr-2.5 pl-2 text-right"><Ch ch={c.line ? "LINE" : "メール"} /></td>
                          </tr>
                        );
                      })}
                    </tbody></table></div>
                  )}
                </div>
              );
            })}
          </div>
        </Panel>
        <Panel title="依頼文">
          <textarea value={msg} onChange={(e) => setMsg(e.target.value)} rows={7}
            className="w-full text-xs border border-slate-300 rounded p-2 leading-relaxed focus:outline-none focus:ring-2 focus:ring-blue-300" />
          <p className="text-xs text-slate-400 mt-1">LINEは本文のみ、メールは件名「【見積依頼】{t.name}」で送信します。</p>
        </Panel>
      </div>
      <div className="space-y-3">
        <Panel title="回答期限と催促">
          <label className="block text-xs">
            <span className="text-slate-500">回答期限</span>
            <input value={due} onChange={(e) => setDue(e.target.value)}
              className="mt-1 w-full text-xs border border-slate-300 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-300" />
          </label>
          <p className="text-xs text-slate-500 mt-2 leading-relaxed">
            期限の24時間前に未回答の会社へAIが自動で催促します。提出期限（{t.submitDeadline}）の3日前を目安に設定してください。
          </p>
        </Panel>
        <Panel title="送信内容">
          <ul className="space-y-2">
            {items.map((i) => (
              <li key={i.trade} className="text-xs">
                <div className="font-semibold">{i.trade}（{i.ids.length}社）</div>
                <div className="text-slate-600">{i.ids.map((id) => partnerById(id).name).join("、")}</div>
              </li>
            ))}
            {items.length === 0 && <li className="text-xs text-slate-500">送信対象がありません。</li>}
          </ul>
          <div className="mt-3 pt-2 border-t border-slate-100 text-xs flex items-center">
            <span className="text-slate-500">合計</span><span className="ml-auto tabular-nums font-semibold">{items.length}業種 / {total}社</span>
          </div>
          <div className="mt-3"><Btn kind="primary" disabled={total === 0} onClick={() => onDraft(items, due)}><Send size={12} />送信内容を確認する</Btn></div>
        </Panel>
      </div>
    </div>
  );
}

function ConfirmSend({ draft, tenders, onClose, onSend }) {
  const t = tenders.find((x) => x.id === draft.tid);
  const total = draft.items.reduce((n, i) => n + i.ids.length, 0);
  return (
    <div className="ai-modal z-30" style={{ backgroundColor: "rgba(15,23,42,0.5)" }}>
      <div className="bg-white rounded-md border border-slate-200 w-full max-w-lg max-h-full overflow-auto">
        <div className="ai-hd px-3 py-2 border-b border-slate-200 sticky top-0 bg-white">
          <h2 className="text-xs font-semibold">見積依頼の送信確認</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X size={16} /></button>
        </div>
        <div className="p-3 space-y-3">
          <div>
            <div className="text-xs font-semibold">{t.name}</div>
            <div className="text-xs text-slate-500">{t.agency}／回答期限 {draft.due}</div>
          </div>
          <table className="w-full text-xs border border-slate-200">
            <thead className="bg-slate-50 text-slate-500"><tr className="text-left">
              <th className="px-2 py-1.5 font-medium">業種</th><th className="px-2 py-1.5 font-medium">送信先</th><th className="px-2 py-1.5 font-medium">手段</th>
            </tr></thead>
            <tbody>
              {draft.items.flatMap((i) => i.ids.map((cid, k) => {
                const c = partnerById(cid);
                return (
                  <tr key={i.trade + cid} className="border-t border-slate-100">
                    <td className="px-2 py-1.5">{k === 0 ? i.trade : ""}</td>
                    <td className="px-2 py-1.5">{c.name}<span className="text-slate-400">／{c.person}</span></td>
                    <td className="px-2 py-1.5"><Ch ch={c.line ? "LINE" : "メール"} /></td>
                  </tr>
                );
              }))}
            </tbody>
          </table>
          <p className="text-xs text-slate-600">{total}社へ送信します。業種ごとに数量表の該当行だけを添付し、返信は自動で取り込みます。</p>
        </div>
        <div className="px-3 py-2 border-t border-slate-200 flex gap-2 justify-end sticky bottom-0 bg-white">
          <Btn onClick={onClose}>やめる</Btn>
          <Btn kind="primary" onClick={onSend}><Send size={12} />承認して送信する</Btn>
        </div>
      </div>
    </div>
  );
}

function OfficialModal({ t, onClose, onSet }) {
  const steps = {
    電子調達システム: ["調達ポータルに企業アカウントでログイン", `案件番号「${t.noticeNo}」で検索`, "入札説明書・仕様書を企業名義でダウンロード（ICカードが必要）", "参加表明と入札書の提出期限を確認"],
    公開Webページ: ["公告記載の窓口へ交付申請（不要な場合はそのまま参加可）", "様式一式をダウンロード", "質問期限までに不明点を照会"],
    公開PDF: ["公告記載の取得方法を確認", "調達ポータルから企業名義で取得"],
    メール交付: ["交付メールに返信して参加表明", "資料一式の再送を依頼（企業名義の記録を残す）"],
    FAX交付: ["FAX申込様式を印刷", "発注機関へ送信（管理者が代行）", "受領資料を手動登録"],
  }[t.via] ?? ["公告記載の手順を確認"];
  return (
    <div className="ai-modal z-30" style={{ backgroundColor: "rgba(15,23,42,0.5)" }}>
      <div className="bg-white rounded-md border border-slate-200 w-full max-w-lg max-h-full overflow-auto">
        <div className="ai-hd px-3 py-2 border-b border-slate-200 sticky top-0 bg-white">
          <h2 className="text-xs font-semibold">正式取得の手順（{t.via}）</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X size={16} /></button>
        </div>
        <div className="p-3 space-y-3">
          <div className="text-xs font-semibold">{t.name}</div>
          <div className="border border-amber-200 bg-amber-50 rounded px-2.5 py-2 text-xs text-amber-900">
            システムが取得した資料は解析用です。この案件は御社名義での正式取得が必要です。
          </div>
          <ol className="space-y-1.5">
            {steps.map((s, i) => <li key={s} className="text-xs text-slate-700 flex gap-2"><span className="tabular-nums text-slate-400 w-4 shrink-0">{i + 1}</span>{s}</li>)}
          </ol>
          <dl><Field label="公告元URL"><span className="break-all">{t.url}</span></Field><Field label="質問期限">{t.qaDeadline}</Field></dl>
          {t.via === "FAX交付" && <p className="text-xs text-slate-500 flex gap-1.5"><Printer size={12} className="mt-0.5 shrink-0" />初期版のFAX交付は管理者が代行します。</p>}
        </div>
        <div className="px-3 py-2 border-t border-slate-200 flex flex-wrap gap-2 justify-end sticky bottom-0 bg-white">
          <Btn onClick={onClose}>閉じる</Btn>
          <Btn onClick={() => onSet(t.id, "申請中")}>申請中にする</Btn>
          <Btn kind="primary" onClick={() => onSet(t.id, "取得済")}>取得済にする</Btn>
        </div>
      </div>
    </div>
  );
}

/* ── 見積比較・原価集計・応札価格 ─────────────────────────────────────────── */
function CompareTab({ t, quotes, inbox, cost, picks, setPicks, onRemind, onImport, onPrice, onGo }) {
  const [profit, setProfit] = useState(COMPANY.profit);
  if (quotes.length === 0) return (
    <Panel title="見積・原価">
      <p className="text-xs text-slate-600">まだ見積依頼を送っていません。</p>
      <div className="mt-2"><Btn kind="primary" onClick={onGo}><Send size={12} />見積依頼へ</Btn></div>
    </Panel>
  );
  const trades = [...new Set(quotes.map((q) => q.trade))];
  const overhead = cost.cost * COMPANY.overhead;
  const bid = (cost.cost + overhead) * (1 + profit);
  const mr = cost.mr;
  const target = t.budget && mr ? t.budget * mr.rate : null;
  const win = target ? bid <= target : null;

  return (
    <div className="space-y-3">
      {inbox.length > 0 && (
        <Panel title={`未取込の返信（${inbox.length}）`}>
          <ul className="space-y-2">
            {inbox.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-2">
                <Ch ch={i.via} /><span className="text-xs font-semibold">{partnerById(i.cid).name}</span><Pill>{i.trade}</Pill>
                {i.amount != null ? <Pill tone="green">{yen(i.amount)}</Pill> : <Pill tone="amber">金額なし</Pill>}
                <Btn size="sm" kind="primary" onClick={() => onImport(i)}>取り込む</Btn>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {trades.map((tr) => {
        const rows = quotes.filter((q) => q.trade === tr);
        const answered = rows.filter((r) => r.amount != null);
        const low = answered.length ? Math.min(...answered.map((r) => r.amount)) : null;
        const pickedId = picks[tr] ?? answered.find((r) => r.amount === low)?.id;
        return (
          <Panel key={tr} title={`${tr}（${answered.length}/${rows.length}社 回答）`} dense>
            <div className="ai-scroll">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-slate-500"><tr className="text-left">
                  <th className="px-3 py-2 font-medium">採用</th><th className="px-2 py-2 font-medium">会社</th>
                  <th className="px-2 py-2 font-medium text-right">金額</th><th className="px-2 py-2 font-medium text-right">最安差</th>
                  <th className="px-2 py-2 font-medium">回答</th><th className="px-2 py-2 font-medium text-right">採用率</th>
                  <th className="px-2 py-2 font-medium">メモ</th><th className="px-2 py-2" />
                </tr></thead>
                <tbody>
                  {rows.map((q) => {
                    const c = partnerById(q.cid);
                    const isLow = q.amount != null && q.amount === low;
                    return (
                      <tr key={q.id} className={`border-t border-slate-100 ${pickedId === q.id ? "bg-emerald-50" : ""}`}>
                        <td className="px-3 py-2">
                          <input type="radio" name={`pick-${tr}`} checked={pickedId === q.id} disabled={q.amount == null}
                            onChange={() => setPicks({ ...picks, [tr]: q.id })} className="accent-blue-800" />
                        </td>
                        <td className="px-2 py-2">
                          <div className="flex items-center gap-1.5"><span className="font-medium">{c.name}</span>{isLow && <Pill tone="green">最安</Pill>}</div>
                          <div className="text-slate-400">{c.base}</div>
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums font-semibold">{q.amount != null ? yen(q.amount) : <span className="text-slate-400 font-normal">未回答</span>}</td>
                        <td className="px-2 py-2 text-right tabular-nums text-slate-600">{q.amount != null && low != null ? (q.amount === low ? "—" : "+" + (q.amount - low).toLocaleString("ja-JP")) : "—"}</td>
                        <td className="px-2 py-2 text-slate-600">
                          {q.at ?? <span className="text-amber-700">未回答</span>}
                          <div className="mt-0.5 flex gap-1"><Ch ch={q.ch} />{q.src && <Pill tone="violet">{q.src}</Pill>}</div>
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums">{Math.round(c.adopt * 100)}%</td>
                        <td className="px-2 py-2 text-slate-600">{q.memo || <span className="text-slate-300">—</span>}</td>
                        <td className="px-2 py-2 text-right">{q.amount == null && <Btn size="sm" onClick={() => onRemind(q)}>催促</Btn>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>
        );
      })}

      <Panel title="原価集計と応札価格の検討" right={<span className="text-xs text-slate-400">積算そのものは行いません</span>}>
        <div className="ai-scroll">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-500"><tr className="text-left">
              <th className="px-3 py-2 font-medium">業種</th><th className="px-2 py-2 font-medium">採用する会社</th>
              <th className="px-2 py-2 font-medium text-right">金額</th><th className="px-2 py-2 font-medium">状態</th>
            </tr></thead>
            <tbody>
              {cost.rows.map((r) => (
                <tr key={r.trade} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-medium">{r.trade}</td>
                  <td className="px-2 py-2">{r.picked ? partnerById(r.picked.cid).name : <span className="text-slate-400">未定</span>}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{r.picked ? yen(r.picked.amount) : "—"}</td>
                  <td className="px-2 py-2">{r.waiting > 0 ? <Pill tone="amber">未回答 {r.waiting}社</Pill> : <Pill tone="green">確定可</Pill>}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-slate-200 bg-slate-50">
                <td className="px-3 py-2 font-semibold" colSpan={2}>協力会社の原価 合計</td>
                <td className="px-2 py-2 text-right tabular-nums font-semibold">{yen(cost.cost)}</td><td />
              </tr>
              <tr className="border-t border-slate-100">
                <td className="px-3 py-2" colSpan={2}>一般管理費（{Math.round(COMPANY.overhead * 100)}%）</td>
                <td className="px-2 py-2 text-right tabular-nums">{yen(overhead)}</td><td />
              </tr>
              <tr className="border-t border-slate-100">
                <td className="px-3 py-2" colSpan={2}>
                  利益（<input type="number" value={Math.round(profit * 100)} onChange={(e) => setProfit(Number(e.target.value) / 100)}
                    className="w-14 text-xs border border-slate-300 rounded px-1 py-0.5 tabular-nums mx-1" />%）
                </td>
                <td className="px-2 py-2 text-right tabular-nums">{yen((cost.cost + overhead) * profit)}</td><td />
              </tr>
              <tr className="border-t-2 border-slate-300 bg-blue-50">
                <td className="px-3 py-2 font-semibold text-blue-900" colSpan={2}>応札価格の案（税抜）</td>
                <td className="px-2 py-2 text-right tabular-nums font-semibold text-blue-900">{yen(bid)}</td><td />
              </tr>
            </tbody>
          </table>
        </div>

        <div className="mt-3 ai-cols ai-cols-2">
          <div className="border border-slate-200 rounded p-2.5">
            <div className="text-xs font-semibold">勝てそうかの目安</div>
            {mr && t.budget ? (
              <>
                <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                  同種案件（{t.item}）の<Term w="落札率" />は平均 {(mr.rate * 100).toFixed(1)}%（{mr.n}件）。
                  <Term w="予定価格" /> {yen(t.budget)} に当てはめると、目安のラインは {yen(target)} です。
                </p>
                <div className="mt-2">
                  {win
                    ? <Pill tone="green"><CheckCircle2 size={12} />応札価格案は目安ライン内（差 {yen(target - bid)}）</Pill>
                    : <Pill tone="rose"><AlertTriangle size={12} />目安ラインを {yen(bid - target)} 超過。利益率か原価の見直しが必要</Pill>}
                </div>
              </>
            ) : (
              <p className="text-xs text-slate-600 mt-1">予定価格が非公表のため、目安ラインは出せません。過去の類似案件を参考にしてください。</p>
            )}
          </div>
          <div className="border border-slate-200 rounded p-2.5">
            <div className="text-xs font-semibold">価格を決める</div>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">
              {cost.waiting > 0 ? `未回答が ${cost.waiting}社あります。締め切ってから決めることもできます。` : "すべての業種で見積が揃っています。"}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Btn kind="primary" onClick={() => onPrice(t.id, Math.round(bid))}>この価格に決定する（{yen(bid)}）</Btn>
            </div>
            {t.bidPrice && <p className="text-xs text-emerald-700 mt-2">決定済み：{yen(t.bidPrice)}</p>}
          </div>
        </div>
      </Panel>
    </div>
  );
}

/* ── 提出書類 ─────────────────────────────────────────────────────────────── */
function FormsTab({ t, onForm, onWork }) {
  const forms = t.forms ?? [];
  const done = forms.filter((x) => x.state === "完了").length;
  if (forms.length === 0) return <Panel title="提出書類"><p className="text-xs text-slate-600">様式の解析後に必要書類を一覧化します。</p></Panel>;
  return (
    <div className="space-y-3">
      <Panel title="提出書類チェックリスト" right={<span className="text-xs text-slate-500 tabular-nums">{done}/{forms.length}</span>}>
        <Bar v={(done / forms.length) * 100} tone="bg-emerald-500" />
        <p className="text-xs text-slate-500 mt-2 leading-relaxed">
          様式ファイルからAIが必要書類を抽出しました。1つでも欠けると失格になるため、提出前にすべて「完了」にしてください。
        </p>
        <div className="mt-2"><Due s={t.submitDeadline} label="提出期限" /></div>
      </Panel>
      <Panel dense>
        <div className="ai-scroll">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-500"><tr className="text-left">
              <th className="px-3 py-2 font-medium">書類</th><th className="px-2 py-2 font-medium">様式</th>
              <th className="px-2 py-2 font-medium">状態</th><th className="px-2 py-2 font-medium">AIからの補足</th><th className="px-2 py-2" />
            </tr></thead>
            <tbody>
              {forms.map((x) => (
                <tr key={x.name} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-medium">{x.name === "内訳書" ? <Term w="内訳書" /> : x.name}</td>
                  <td className="px-2 py-2 text-slate-500">{x.source}</td>
                  <td className="px-2 py-2">
                    {x.state === "完了" ? <Pill tone="green">完了</Pill> : x.state === "作成中" ? <Pill tone="amber">作成中</Pill> : <Pill>未着手</Pill>}
                  </td>
                  <td className="px-2 py-2 text-slate-600">{x.note || <span className="text-slate-300">—</span>}</td>
                  <td className="px-2 py-2 text-right whitespace-nowrap">
                    <select value={x.state} onChange={(e) => onForm(t.id, x.name, e.target.value)}
                      className="text-xs border border-slate-300 rounded px-1.5 py-1 bg-white">
                      {["未着手", "作成中", "完了"].map((s) => <option key={s}>{s}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel title="提出">
        <p className="text-xs text-slate-600 leading-relaxed">
          書類が揃ったら、調達ポータル（電子調達システム）で入札書を提出します。提出後の取り下げはできません。
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Btn kind="primary" disabled={done < forms.length} onClick={() => onWork("提出済")}>
            <CheckCircle2 size={12} />提出済みにする
          </Btn>
          {done < forms.length && <span className="text-xs text-slate-500 self-center">未完了の書類が {forms.length - done}件あります</span>}
        </div>
      </Panel>
    </div>
  );
}

/* ── 結果 ─────────────────────────────────────────────────────────────────── */
function ResultTab({ t, onAward }) {
  const [amount, setAmount] = useState("");
  const mr = marketRate(t.item);
  if (t.award) {
    const rate = t.award.amount / t.award.budget;
    return (
      <div className="space-y-3">
        <Panel title="開札結果">
          <div className="flex flex-wrap items-center gap-2">
            {t.award.winner === "自社" ? <Pill tone="green"><Award size={12} />落札</Pill> : <Pill tone="rose">失注</Pill>}
            <span className="text-xs text-slate-500">{t.award.date}</span>
          </div>
          <dl className="mt-2">
            <Field label="落札額">{yen(t.award.amount)}</Field>
            <Field label={<Term w="予定価格" />}>{yen(t.award.budget)}</Field>
            <Field label={<Term w="落札率" />}>{(rate * 100).toFixed(1)}%</Field>
            <Field label="備考">{t.award.note}</Field>
          </dl>
        </Panel>
        <Panel title="次に活きること">
          <p className="text-xs text-slate-600 leading-relaxed">
            この結果は相場データに反映され、同じ<Term w="営業品目" />の案件で応札価格を検討するときの目安になります。
            現在の{t.item}の平均落札率は {mr ? (mr.rate * 100).toFixed(1) + "%" : "—"}（{mr?.n ?? 0}件）です。
          </p>
        </Panel>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <Panel title="開札結果の記録">
        <p className="text-xs text-slate-600 leading-relaxed">
          <Term w="開札" />は {t.bidOpen} です。結果が出たら落札額を入力してください。落札できなかった場合も、いくらで負けたかが次の判断材料になります。
        </p>
        <div className="mt-2 flex flex-wrap gap-2 items-end">
          <label className="text-xs">
            <span className="text-slate-500 block">落札額（税抜）</span>
            <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)}
              className="mt-1 text-xs border border-slate-300 rounded px-2 py-1.5 tabular-nums w-44" />
          </label>
          <Btn kind="primary" disabled={!amount} onClick={() => onAward(t.id, Number(amount), true)}>落札した</Btn>
          <Btn disabled={!amount} onClick={() => onAward(t.id, Number(amount), false)}>他社が落札した</Btn>
        </div>
        {t.bidPrice && <p className="text-xs text-slate-500 mt-2">自社の応札価格：{yen(t.bidPrice)}</p>}
      </Panel>
    </div>
  );
}

/* =============================================================================
   共通案件マスタ／収集エンジン
============================================================================= */
function MasterView({ tenders, onOpen }) {
  const [f, setF] = useState("すべて");
  const rows = tenders.filter((t) => f === "すべて" || t.collect === f);
  return (
    <Panel title={`共通案件マスタ（${rows.length}／全 ${tenders.length}件）`} dense
      right={<span className="text-xs text-slate-400">全ユーザー共通・重複排除済み／提案は企業ごとの別レコード</span>}>
      <div className="px-3 py-2 border-b border-slate-200 ai-scroll-x flex gap-1">
        {["すべて", ...COLLECT].map((x) => (
          <button key={x} onClick={() => setF(x)}
            className={`shrink-0 text-xs px-2 py-1 rounded border ${f === x ? "bg-slate-800 text-white border-slate-800" : "bg-white border-slate-200 text-slate-600"}`}>
            {x}<span className="ml-1 text-slate-400 tabular-nums">{x === "すべて" ? tenders.length : tenders.filter((t) => t.collect === x).length}</span>
          </button>
        ))}
      </div>
      <div className="ai-scroll">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-slate-500"><tr className="text-left">
            <th className="px-3 py-2 font-medium">案件ID／件名</th><th className="px-2 py-2 font-medium">発注機関</th>
            <th className="px-2 py-2 font-medium">区分・品目・等級</th><th className="px-2 py-2 font-medium">提出期限</th>
            <th className="px-2 py-2 font-medium">収集</th><th className="px-2 py-2 font-medium">資料</th>
            <th className="px-2 py-2 font-medium">自社への提案</th><th className="px-2 py-2 font-medium text-right">適合率</th>
          </tr></thead>
          <tbody>
            {rows.map((t) => {
              const fit = evaluateFit(t);
              const got = t.docs.filter((x) => x.got).length;
              return (
                <tr key={t.id} className="border-t border-slate-100 hover:bg-slate-50 align-top">
                  <td className="px-3 py-2">
                    <div className="text-slate-400 tabular-nums">{t.id}</div>
                    <button onClick={() => onOpen(t.id)} className="font-medium text-left hover:underline">{t.name}</button>
                    <div className="text-slate-400">重複キー {t.dedupe}</div>
                  </td>
                  <td className="px-2 py-2 text-slate-600">{t.agency}<div className="text-slate-400">{t.org}</div></td>
                  <td className="px-2 py-2"><div className="flex flex-wrap gap-1"><Pill>{t.kind}</Pill><Pill>{t.item}</Pill><Pill>{t.grade}</Pill></div></td>
                  <td className="px-2 py-2 tabular-nums text-slate-600">{t.submitDeadline}</td>
                  <td className="px-2 py-2"><CollectPill s={t.collect} /></td>
                  <td className="px-2 py-2 tabular-nums">{got}/{t.docs.length}</td>
                  <td className="px-2 py-2"><ProposePill s={t.proposal?.state} /></td>
                  <td className="px-2 py-2 text-right">{t.analysis ? <span className="tabular-nums font-semibold">{fit.score}%</span> : <span className="text-slate-400">—</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function EngineView({ tenders, onOpen, onRetry, onManual, onParse, onPublish }) {
  const queue = tenders.filter((t) => t.collect !== "終了");
  return (
    <div className="space-y-3">
      <Panel title="収集ジョブ" right={<Btn size="sm"><RefreshCw size={12} />今すぐ巡回する</Btn>}>
        <div className="ai-cols ai-cols-4">
          {[["スケジュール", "毎日 04:00 / 12:00"], ["前回実行", "07/30 04:00〜04:38"], ["対象", "全省庁統一資格（物品・役務）"], ["重複排除キー", "機関＋公告番号＋提出期限"]].map(([l, v]) => (
            <div key={l} className="border border-slate-200 rounded px-2 py-1.5">
              <div className="text-xs text-slate-500">{l}</div><div className="text-xs font-semibold mt-0.5">{v}</div>
            </div>
          ))}
        </div>
      </Panel>
      <Panel title={`コネクタ（${CONNECTORS.length}）`} dense right={<Btn size="sm">コネクタを追加</Btn>}>
        <div className="ai-scroll">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-500"><tr className="text-left">
              <th className="px-3 py-2 font-medium">コネクタ</th><th className="px-2 py-2 font-medium">種別</th>
              <th className="px-2 py-2 font-medium">状態</th><th className="px-2 py-2 font-medium">最終巡回</th>
              <th className="px-2 py-2 font-medium text-right">検知</th><th className="px-2 py-2 font-medium text-right">資料</th>
              <th className="px-2 py-2 font-medium text-right">失敗</th><th className="px-2 py-2 font-medium">備考</th>
            </tr></thead>
            <tbody>
              {CONNECTORS.map((c) => (
                <tr key={c.id} className="border-t border-slate-100 align-top">
                  <td className="px-3 py-2 font-medium">{c.name}<div className="text-slate-500 font-normal">{c.target}</div></td>
                  <td className="px-2 py-2"><Pill>{c.kind}</Pill></td>
                  <td className="px-2 py-2">{c.state === "稼働中" ? <Pill tone="green">稼働中</Pill> : c.state === "手動" ? <Pill tone="amber">手動</Pill> : <Pill>未接続</Pill>}</td>
                  <td className="px-2 py-2 tabular-nums text-slate-600">{c.last}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{c.found}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{c.docs}</td>
                  <td className={`px-2 py-2 text-right tabular-nums ${c.fail ? "text-rose-700 font-semibold" : "text-slate-400"}`}>{c.fail}</td>
                  <td className="px-2 py-2 text-slate-500">{c.note || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel title="収集端末（ICカードでの資料取得）" dense right={<span className="text-xs text-slate-400">電子調達システムの資料取得に使用</span>}>
        <div className="ai-scroll">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-500"><tr className="text-left">
              <th className="px-3 py-2 font-medium">端末</th><th className="px-2 py-2 font-medium">状態</th>
              <th className="px-2 py-2 font-medium">最終応答</th><th className="px-2 py-2 font-medium">電子証明書</th>
              <th className="px-2 py-2 font-medium text-right">本日の取得</th><th className="px-2 py-2 font-medium">備考</th>
            </tr></thead>
            <tbody>
              {AGENTS.map((a) => (
                <tr key={a.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-medium">{a.label}<div className="text-slate-400">{a.id}</div></td>
                  <td className="px-2 py-2">{a.status === "稼働中" ? <Pill tone="green">稼働中</Pill> : <Pill>待機</Pill>}</td>
                  <td className="px-2 py-2 tabular-nums text-slate-600">{a.lastBeat}</td>
                  <td className="px-2 py-2">
                    <span className="tabular-nums">{a.certExpires}</span>
                    <div className={a.certDays <= 90 ? "text-rose-700 font-semibold" : "text-slate-400"}>残{a.certDays}日</div>
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{a.today}</td>
                  <td className="px-2 py-2 text-slate-500">{a.note || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-3 py-2 border-t border-slate-200 text-xs text-slate-500 leading-relaxed">
          ICカードは物理カードとPINが必要なため、クラウドからは操作できません。社内の端末がジョブを取りに来て資料を取得します。
          <span className="text-rose-700 font-semibold">PINの自動リトライは行いません</span>（カードがロックされると再発行まで収集が止まるため）。
        </div>
      </Panel>

      <Panel title={`取得キュー（${queue.length}）`} dense right={<span className="text-xs text-slate-400">未取得→取得中→取得済→AI解析中→解析完了→公開中→終了</span>}>
        <div className="ai-scroll">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-500"><tr className="text-left">
              <th className="px-3 py-2 font-medium">案件</th><th className="px-2 py-2 font-medium">取得方法</th>
              <th className="px-2 py-2 font-medium">収集</th><th className="px-2 py-2 font-medium">資料</th>
              <th className="px-2 py-2 font-medium">解析</th><th className="px-2 py-2 font-medium">失敗理由</th><th className="px-2 py-2" />
            </tr></thead>
            <tbody>
              {queue.map((t) => {
                const got = t.docs.filter((x) => x.got).length;
                return (
                  <tr key={t.id} className="border-t border-slate-100 align-top">
                    <td className="px-3 py-2">
                      <div className="text-slate-400 tabular-nums">{t.id}</div>
                      <button onClick={() => onOpen(t.id, "docs")} className="font-medium text-left hover:underline">{t.name}</button>
                    </td>
                    <td className="px-2 py-2"><Pill>{t.via}</Pill></td>
                    <td className="px-2 py-2"><CollectPill s={t.collect} /></td>
                    <td className="px-2 py-2 tabular-nums">{got}/{t.docs.length}</td>
                    <td className="px-2 py-2">{t.parse === "完了" ? <Pill tone="violet">完了</Pill> : t.parse === "処理中" ? <Pill tone="amber">処理中</Pill> : <span className="text-slate-400">未実施</span>}</td>
                    <td className="px-2 py-2 text-rose-700">{t.failure ? t.failure.reason : <span className="text-slate-300">—</span>}</td>
                    <td className="px-2 py-2 text-right whitespace-nowrap">
                      <div className="inline-flex gap-1">
                        {t.failure && t.via !== "FAX交付" && <Btn size="sm" onClick={() => onRetry(t.id)}>再取得</Btn>}
                        {t.failure && <Btn size="sm" onClick={() => onManual(t.id)}>手動登録</Btn>}
                        {!t.failure && t.parse !== "完了" && <Btn size="sm" onClick={() => onParse(t.id)}>解析</Btn>}
                        {t.collect === "解析完了" && <Btn size="sm" onClick={() => onPublish(t.id)}>公開</Btn>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

/* =============================================================================
   協力会社 / 相場 / 条件 / 資格 / 開拓
============================================================================= */
function PartnersView({ tenders, quotes, added = [] }) {
  const [q, setQ] = useState("");
  const [trade, setTrade] = useState("すべて");
  const [openId, setOpenId] = useState(null);
  const trades = ["すべて", ...new Set(PARTNERS.flatMap((p) => p.trades))];
  const rows = PARTNERS.filter((p) => (trade === "すべて" || p.trades.includes(trade)) && (q === "" || p.name.includes(q) || p.base.includes(q)));
  const open = PARTNERS.find((p) => p.id === openId);
  const load = (cid) => quotes.filter((x) => x.cid === cid && x.amount == null).length;
  const missing = COMPANY.partnerTrades.filter((t) => !PARTNERS.some((p) => p.trades.includes(t)));
  return (
    <div className="space-y-3">
      <Panel dense title={`協力会社（${rows.length}）`} right={<Btn size="sm">会社を追加</Btn>}>
        <div className="px-3 py-2 border-b border-slate-200 flex flex-wrap gap-2 items-center">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="会社名・所在地で検索"
            className="text-xs border border-slate-300 rounded px-2 py-1 w-48 focus:outline-none focus:ring-2 focus:ring-blue-300" />
          <div className="ai-scroll-x flex gap-1">
            {trades.map((t) => (
              <button key={t} onClick={() => setTrade(t)}
                className={`shrink-0 text-xs px-2 py-1 rounded border ${trade === t ? "bg-slate-800 text-white border-slate-800" : "bg-white border-slate-200 text-slate-600"}`}>{t}</button>
            ))}
          </div>
        </div>
        <div className="ai-scroll">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-500"><tr className="text-left">
              <th className="px-3 py-2 font-medium">会社／担当者</th><th className="px-2 py-2 font-medium">業種</th>
              <th className="px-2 py-2 font-medium">エリア</th><th className="px-2 py-2 font-medium">連絡</th>
              <th className="px-2 py-2 font-medium text-right">回答待ち</th><th className="px-2 py-2 font-medium text-right">採用率</th>
              <th className="px-2 py-2 font-medium text-right">回答速度</th><th className="px-2 py-2 font-medium text-right">評価</th>
            </tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer" onClick={() => setOpenId(p.id === openId ? null : p.id)}>
                  <td className="px-3 py-2"><div className="font-medium">{p.name}</div><div className="text-slate-500">{p.person}／{p.base}</div></td>
                  <td className="px-2 py-2"><div className="flex gap-1 flex-wrap">{p.trades.map((t) => <Pill key={t}>{t}</Pill>)}</div></td>
                  <td className="px-2 py-2 text-slate-600">{p.areas.join("・")}</td>
                  <td className="px-2 py-2"><div className="flex gap-1">{p.line ? <Ch ch="LINE" /> : null}{p.mail ? <Ch ch="メール" /> : null}</div></td>
                  <td className={`px-2 py-2 text-right tabular-nums ${load(p.id) ? "text-amber-700 font-semibold" : "text-slate-400"}`}>{load(p.id)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{Math.round(p.adopt * 100)}%</td>
                  <td className="px-2 py-2 text-right tabular-nums">{p.resp}h</td>
                  <td className="px-2 py-2 text-right tabular-nums">{p.rating}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      {missing.length > 0 && (
        <Panel title="登録が不足している業種">
          <p className="text-xs text-slate-600">{missing.join("・")}（この業種が必要な案件では適合率が下がります）</p>
        </Panel>
      )}
      {open && (
        <Panel title={open.name} right={<Btn size="sm" onClick={() => setOpenId(null)}>閉じる</Btn>}>
          <div className="ai-cols ai-cols-2">
            <dl>
              <Field label="担当者">{open.person}</Field><Field label="所在地">{open.base}</Field>
              <Field label="業種">{open.trades.join("・")}</Field><Field label="対応エリア">{open.areas.join("・")}</Field>
              <Field label="電話"><span className="inline-flex items-center gap-1"><Phone size={11} />{open.tel}</span></Field>
            </dl>
            <dl>
              <Field label="過去見積件数">{open.quotes}件</Field><Field label="採用率">{Math.round(open.adopt * 100)}%</Field>
              <Field label="平均回答速度">{open.resp}時間</Field>
              <Field label="評価"><span className="inline-flex items-center gap-1"><Star size={11} className="text-amber-500" />{open.rating}</span></Field>
              <Field label="メモ">{open.memo || "—"}</Field>
            </dl>
          </div>
          <div className="mt-3 border border-blue-200 bg-blue-50 rounded p-2.5">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-blue-900"><Sparkles size={13} />AIのおすすめ度（提案中の案件）</div>
            <ul className="mt-1.5 space-y-1">
              {tenders.filter((t) => (t.analysis?.trades ?? []).some((x) => open.trades.includes(x.trade))).slice(0, 3).map((t) => (
                <li key={t.id} className="text-xs flex items-center gap-2">
                  <span className="tabular-nums text-blue-900 font-semibold w-8">{recommendScore(open, t)}</span>
                  <span className="text-slate-700 truncate">{t.name}</span>
                  <span className="ml-auto text-slate-500 shrink-0">{reasonFor(open, t)}</span>
                </li>
              ))}
            </ul>
          </div>
        </Panel>
      )}
    </div>
  );
}

function MarketView() {
  const items = [...new Set(AWARDS.map((a) => a.item))];
  return (
    <div className="space-y-3">
      <Panel title="落札結果と相場">
        <p className="text-xs text-slate-600 leading-relaxed">
          公開されている落札実績のオープンデータと、御社が参加した案件の結果を蓄積しています。<Term w="落札率" />の平均が分かると、応札価格を決めるときの目安になります。件数が増えるほど精度が上がります。
        </p>
      </Panel>
      <div className="ai-cols ai-cols-3">
        {items.map((it) => {
          const mr = marketRate(it);
          return (
            <Panel key={it} title={it}>
              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-semibold tabular-nums">{(mr.rate * 100).toFixed(1)}</span><span className="text-xs text-slate-500">% 平均落札率</span>
              </div>
              <Bar v={mr.rate * 100} tone="bg-blue-700" />
              <p className="text-xs text-slate-500 mt-1">{mr.n}件の実績から算出</p>
            </Panel>
          );
        })}
      </div>
      <Panel title="開札結果の履歴" dense>
        <div className="ai-scroll">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-500"><tr className="text-left">
              <th className="px-3 py-2 font-medium">案件</th><th className="px-2 py-2 font-medium">品目</th>
              <th className="px-2 py-2 font-medium text-right">予定価格</th><th className="px-2 py-2 font-medium text-right">落札額</th>
              <th className="px-2 py-2 font-medium text-right">落札率</th><th className="px-2 py-2 font-medium">結果</th>
            </tr></thead>
            <tbody>
              {AWARDS.map((a) => (
                <tr key={a.id} className="border-t border-slate-100">
                  <td className="px-3 py-2"><div className="font-medium">{a.name}</div><div className="text-slate-500">{a.agency}／{a.date}</div></td>
                  <td className="px-2 py-2"><Pill>{a.item}</Pill></td>
                  <td className="px-2 py-2 text-right tabular-nums">{yen(a.budget)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{yen(a.amount)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{((a.amount / a.budget) * 100).toFixed(1)}%</td>
                  <td className="px-2 py-2">{a.winner === "自社" ? <Pill tone="green">自社が落札</Pill> : <Pill>他社</Pill>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

function ConditionsView({ onNotify }) {
  const [c, setC] = useState({ ...COMPANY, setName: "全省庁統一資格・関東（役務中心）" });
  const items = ["建物管理等", "清掃", "警備", "植栽等管理", "什器類", "事務用品", "理化学機器", "情報処理", "運送", "廃棄物処理"];
  const areas = ["北海道", "東北", "関東・甲信越", "東海・北陸", "近畿", "中国", "四国", "九州・沖縄"];
  const toggle = (key, v) => setC((s) => ({ ...s, [key]: s[key].includes(v) ? s[key].filter((x) => x !== v) : [...s[key], v] }));
  const Row = ({ label, hint, children }) => (
    <div className="ai-fieldrow py-2.5 border-b border-slate-100 last:border-0">
      <div><div className="text-xs font-medium text-slate-700">{label}</div>{hint && <div className="text-xs text-slate-400 mt-0.5">{hint}</div>}</div>
      <div>{children}</div>
    </div>
  );
  const input = "text-xs border border-slate-300 rounded px-2 py-1 bg-white focus:outline-none focus:ring-2 focus:ring-blue-300";
  return (
    <div className="space-y-3">
      <Panel title="条件セット" right={<Btn size="sm">セットを追加</Btn>}>
        <div className="flex gap-1 flex-wrap">
          <span className="text-xs px-2 py-1 rounded bg-slate-800 text-white">全省庁統一資格・関東（役務中心）</span>
          <span className="text-xs px-2 py-1 rounded border border-slate-200 text-slate-600">物品（什器・事務用品）</span>
        </div>
        <p className="text-xs text-slate-500 mt-2">条件セットごとに案件マスタと照合し、適合した案件だけを提案します。</p>
      </Panel>
      <Panel title="照合条件">
        <Row label="セット名"><input className={`${input} ai-w72`} value={c.setName} onChange={(e) => setC({ ...c, setName: e.target.value })} /></Row>
        <Row label={<Term w="営業品目" />} hint="登録済みの品目だけ選べます">
          <div className="flex flex-wrap gap-1">
            {items.map((i) => (
              <button key={i} onClick={() => toggle("items", i)}
                className={`text-xs px-2 py-1 rounded border ${c.items.includes(i) ? "bg-blue-50 border-blue-300 text-blue-800" : "bg-white border-slate-200 text-slate-500"}`}>{i}</button>
            ))}
          </div>
        </Row>
        <Row label={<Term w="競争参加地域" />}>
          <div className="flex flex-wrap gap-1">
            {areas.map((a) => (
              <button key={a} onClick={() => toggle("areas", a)}
                className={`text-xs px-2 py-1 rounded border ${c.areas.includes(a) ? "bg-blue-50 border-blue-300 text-blue-800" : "bg-white border-slate-200 text-slate-500"}`}>{a}</button>
            ))}
          </div>
        </Row>
        <Row label="キーワード" hint="案件名・仕様書の本文を検索します">
          <div className="flex flex-wrap gap-1">
            {c.keywords.map((k) => <Pill key={k} tone="blue">{k}<X size={11} /></Pill>)}
            <button className="text-xs border border-dashed border-slate-300 rounded px-2 py-0.5 text-slate-500">+ 追加</button>
          </div>
        </Row>
        <Row label="除外キーワード" hint="これを含む案件は提案しません">
          <div className="flex flex-wrap gap-1">
            {c.ngWords.map((k) => <Pill key={k} tone="rose">{k}<X size={11} /></Pill>)}
            <button className="text-xs border border-dashed border-slate-300 rounded px-2 py-0.5 text-slate-500">+ 追加</button>
          </div>
        </Row>
        <Row label="金額の範囲">
          <div className="flex items-center gap-2 text-xs flex-wrap">
            <input type="number" className={`${input} w-32 tabular-nums`} value={c.min} onChange={(e) => setC({ ...c, min: +e.target.value })} />
            <span>〜</span>
            <input type="number" className={`${input} w-32 tabular-nums`} value={c.max} onChange={(e) => setC({ ...c, max: +e.target.value })} />
            <span className="text-slate-500">円</span>
          </div>
        </Row>
        <Row label="提出期限までの残日数" hint="準備が間に合わない案件は提案しません">
          <div className="flex items-center gap-2 text-xs">
            <input type="number" className={`${input} w-20 tabular-nums`} value={c.minDays} onChange={(e) => setC({ ...c, minDays: +e.target.value })} />
            <span className="text-slate-500">日以上</span>
          </div>
        </Row>
        <Row label="原価に上乗せする率" hint="応札価格の計算に使います">
          <div className="flex items-center gap-3 text-xs flex-wrap">
            <label className="flex items-center gap-1">一般管理費
              <input type="number" className={`${input} w-16 tabular-nums`} value={Math.round(c.overhead * 100)} onChange={(e) => setC({ ...c, overhead: +e.target.value / 100 })} />%
            </label>
            <label className="flex items-center gap-1">目標利益
              <input type="number" className={`${input} w-16 tabular-nums`} value={Math.round(c.profit * 100)} onChange={(e) => setC({ ...c, profit: +e.target.value / 100 })} />%
            </label>
          </div>
        </Row>
        <div className="flex flex-wrap gap-2 pt-3">
          <Btn kind="primary" onClick={() => onNotify("条件を保存しました。次回の収集ジョブから適用されます")}>条件を保存する</Btn>
          <Btn onClick={() => onNotify("案件マスタと再照合しました：提案対象 3件・対象外 2件")}>今すぐ再照合する</Btn>
        </div>
      </Panel>
    </div>
  );
}

/* 入札資格（素人の入口） */
function QualView() {
  const steps = [
    { n: "必要書類を集める", d: "登記事項証明書、納税証明書、財務諸表など。個人事業主の場合は別の書類になります。" },
    { n: "オンラインで申請する", d: "統一資格審査申請のサイトから申請します。紙での申請も可能です。" },
    { n: "審査を待つ", d: "審査には数週間かかります。決算内容などから等級（A〜D）が決まります。" },
    { n: "資格審査結果通知書を受け取る", d: "この通知書が入札参加の証明になります。入札のたびに写しを提出します。" },
    { n: "電子調達の準備をする", d: "電子入札にはICカードとカードリーダーが必要です。取得に2週間程度かかります。" },
  ];
  return (
    <div className="space-y-3">
      <Panel title="御社の入札資格">
        <div className="ai-cols ai-cols-2">
          <dl>
            <Field label={<Term w="全省庁統一資格" />}>{COMPANY.quals.join("・")}</Field>
            <Field label={<Term w="等級" />}>{Object.entries(COMPANY.grades).map(([k, v]) => `${k}：${v}`).join("／")}</Field>
            <Field label={<Term w="営業品目" />}>{COMPANY.items.join("・")}</Field>
            <Field label={<Term w="競争参加地域" />}>{COMPANY.areas.join("・")}</Field>
          </dl>
          <div className="border border-slate-200 rounded p-2.5">
            <div className="text-xs font-semibold">有効期限</div>
            <div className="text-lg font-semibold tabular-nums mt-1">{COMPANY.qualValidTo}</div>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">
              資格の有効期間は3年度単位です。期限が切れると入札に参加できなくなるため、期限の3か月前にお知らせします。
            </p>
          </div>
        </div>
      </Panel>
      <Panel title="営業品目を増やすと、提案が増えます">
        <p className="text-xs text-slate-600 leading-relaxed">
          登録していない<Term w="営業品目" />の案件には参加できません。直近1か月で、品目が未登録のために対象外になった案件は 2件（情報処理・理化学機器）です。
          追加は資格の変更申請で行えます。
        </p>
      </Panel>
      <Panel title="これから資格を取る方へ">
        <ol className="space-y-2">
          {steps.map((s, i) => (
            <li key={s.n} className="flex gap-2.5">
              <span className="w-5 h-5 shrink-0 grid place-items-center rounded-full bg-slate-800 text-white text-xs tabular-nums">{i + 1}</span>
              <div>
                <div className="text-xs font-semibold">{s.n}</div>
                <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{s.d}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="text-xs text-slate-400 mt-3">※ 手続きの詳細と最新の様式は、必ず公式サイトでご確認ください。</p>
      </Panel>
    </div>
  );
}

function TeamView() {
  const full = USERS.length >= PLAN.seats;
  return (
    <div className="space-y-3">
      <Panel title="ご契約中のプラン">
        <div className="ai-cols ai-cols-3">
          {[["プラン", PLAN.name], ["ユーザー数", `${USERS.length} / ${PLAN.seats}名`], ["条件セット", `2 / ${PLAN.criteriaSets}`]].map(([l, v]) => (
            <div key={l} className="border border-slate-200 rounded px-3 py-2">
              <div className="text-xs text-slate-500">{l}</div>
              <div className="text-sm font-semibold mt-0.5">{v}</div>
            </div>
          ))}
        </div>
        <p className="text-xs text-slate-500 mt-2 leading-relaxed">
          プロプランにすると、ユーザーと条件セットが無制限になり、落札結果の分析・協力会社の開拓機能・チャットとオンラインでのサポートがご利用いただけます。
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Btn kind="primary">プロプランに変更する</Btn>
          <Btn>請求と支払い方法</Btn>
        </div>
      </Panel>

      <Panel title={`ユーザー（${USERS.length}／${PLAN.seats}名）`} dense
        right={<Btn size="sm" disabled={full}>ユーザーを追加</Btn>}>
        <div className="ai-scroll">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-500"><tr className="text-left">
              <th className="px-3 py-2 font-medium">名前</th><th className="px-2 py-2 font-medium">メール</th>
              <th className="px-2 py-2 font-medium">権限</th><th className="px-2 py-2 font-medium">最終ログイン</th><th className="px-2 py-2" />
            </tr></thead>
            <tbody>
              {USERS.map((u) => (
                <tr key={u.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-medium">{u.name}</td>
                  <td className="px-2 py-2 text-slate-600 break-all">{u.mail}</td>
                  <td className="px-2 py-2">{u.role === "管理者" ? <Pill tone="violet">管理者</Pill> : <Pill>担当者</Pill>}</td>
                  <td className="px-2 py-2 text-slate-600">{u.last}</td>
                  <td className="px-2 py-2 text-right"><Btn size="sm">編集</Btn></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {full && <div className="px-3 py-2 border-t border-slate-200 text-xs text-amber-800">
          スタンダードプランのユーザー数の上限（{PLAN.seats}名）に達しています。追加するにはプロプランへの変更が必要です。
        </div>}
      </Panel>

      <Panel title="権限でできること">
        <div className="ai-scroll">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-500"><tr className="text-left">
              <th className="px-3 py-2 font-medium">操作</th><th className="px-2 py-2 font-medium">管理者</th><th className="px-2 py-2 font-medium">担当者</th>
            </tr></thead>
            <tbody>
              {[
                ["案件を見る・進める", "○", "○"],
                ["見積依頼を送る", "○", "○"],
                ["応札価格を決める", "○", "○"],
                ["提案条件・入札資格を変更する", "○", "—"],
                ["協力会社を追加・削除する", "○", "○"],
                ["ユーザーを追加・削除する", "○", "—"],
                ["プラン変更・支払い方法の変更", "○", "—"],
              ].map((r) => (
                <tr key={r[0]} className="border-t border-slate-100">
                  <td className="px-3 py-2">{r[0]}</td>
                  <td className="px-2 py-2 text-center">{r[1]}</td>
                  <td className="px-2 py-2 text-center text-slate-500">{r[2]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

function ProspectView({ prospects, added, tenders, onSend, onReply, onRegister, onRestore }) {
  const [area, setArea] = useState("すべて");
  const [picked, setPicked] = useState([]);
  const [openId, setOpenId] = useState(null);
  const [tpl, setTpl] = useState("mail");
  const covered = new Set(PARTNERS.flatMap((p) => p.trades));

  // 提案中の案件から不足業種を検出
  const gaps = [];
  tenders.filter((t) => t.proposal && t.proposal.state !== "対象外").forEach((t) => {
    (t.analysis?.trades ?? []).filter((x) => !x.skip).forEach((x) => {
      const list = PARTNERS.filter((p) => p.trades.includes(x.trade));
      const inArea = list.filter((p) => p.areas.some((a) => t.place.includes(a)));
      if (list.length === 0) gaps.push({ trade: x.trade, place: t.place, why: "登録会社なし", t });
      else if (inArea.length === 0) gaps.push({ trade: x.trade, place: t.place, why: `${list.length}社いるが対応エリア外`, t });
    });
  });

  const active = prospects.filter((r) => r.state !== "対象外");
  const excluded = prospects.filter((r) => r.state === "対象外");
  const sent = prospects.filter((r) => (r.history ?? []).some((h) => h.kind === "送信")).length;
  const replied = prospects.filter((r) => (r.history ?? []).some((h) => h.kind === "返信")).length;
  const registered = prospects.filter((r) => r.state === "登録済").length;
  const pct = (a, b) => (b === 0 ? "—" : Math.round((a / b) * 100) + "%");

  const toggle = (tr) => setPicked((p) => (p.includes(tr) ? p.filter((x) => x !== tr) : [...p, tr]));
  const shown = active.filter((r) => (picked.length === 0 || picked.includes(r.trade)) && (area === "すべて" || r.area.includes(area)));
  const tone = { 未送信: "slate", 送信済: "blue", "返信あり（前向き）": "green", 登録済: "violet", "登録済み（既存）": "slate" };
  const open = prospects.find((r) => r.id === openId);

  const mailText = `{{会社名}} ご担当者様

はじめてご連絡いたします。${COMPANY.name}の担当と申します。
{{見つけた経緯}}、ご連絡いたしました。

当社は官公庁の入札案件に参加しており、案件ごとに{{業種}}の見積をお願いできる会社を探しています。

・案件が出たときに、御社の担当分の数量だけをお送りします
・金額をご返信いただくだけで完了です。書式の指定はありません
・仕様書や公告など、お読みいただく資料はありません
・当社が落札した場合のみ、正式に発注いたします

まずは一度、案件が出たときにお声がけしてもよろしいでしょうか。
今後のご連絡が不要な場合は、その旨をご返信いただければ以後お送りいたしません。`;
  const formText = `はじめてご連絡いたします。${COMPANY.name}と申します。官公庁の入札案件で、{{業種}}の見積をお願いできる会社を探しております。案件ごとに御社の担当分の数量のみをお送りし、金額をご返信いただくだけで完了する形です。資料をお読みいただく必要はありません。当社が落札した場合のみ正式に発注いたします。一度お声がけしてよろしいかどうか、ご返信いただけますと幸いです。`;

  return (
    <div className="space-y-3">
      <Panel title="開拓の成果">
        <div className="ai-flat border border-slate-200 rounded divide-x divide-slate-100">
          {[["送信", sent, null], ["返信", replied, pct(replied, sent)], ["登録", registered, pct(registered, replied)], ["除外", excluded.length, null]].map(([l, v, r]) => (
            <div key={l} className="px-3 py-2">
              <div className="text-xs text-slate-500">{l}</div>
              <div className="text-lg font-semibold tabular-nums">{v}<span className="text-xs text-slate-400 ml-1.5 font-normal">{r ?? ""}</span></div>
            </div>
          ))}
        </div>
        <p className="text-xs text-slate-500 mt-2 leading-relaxed">
          返信率の目安は15%、返信のうち登録に至る割合は60%です。返信率が低いときは、文面より「見つけた経緯」を書いているかを疑ってください。
        </p>
      </Panel>

      <Panel title="いま足りていない業種">
        {gaps.length === 0 ? <p className="text-xs text-slate-500">提案中の案件で不足している業種はありません。</p> : (
          <ul className="space-y-1.5">
            {gaps.map((g, i) => (
              <li key={i} className="text-xs flex flex-wrap items-center gap-2">
                <Pill tone="rose">{g.trade}</Pill><span className="text-slate-700">{g.place}</span>
                <span className="text-slate-500">{g.why}</span><span className="text-slate-400 truncate">（{g.t.name}）</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="候補を集める条件">
        <div className="flex flex-wrap gap-3 items-end">
          <label className="text-xs">
            <span className="text-slate-500 block">地域</span>
            <select value={area} onChange={(e) => setArea(e.target.value)} className="mt-1 text-xs border border-slate-300 rounded px-2 py-1.5 bg-white">
              {["すべて", "群馬県", "茨城県", "東京都"].map((a) => <option key={a}>{a}</option>)}
            </select>
          </label>
          <div className="text-xs">
            <span className="text-slate-500 block mb-1">業種</span>
            <div className="flex flex-wrap gap-1">
              {[...new Set(prospects.map((r) => r.trade))].map((tr) => (
                <button key={tr} onClick={() => toggle(tr)}
                  className={`text-xs px-2 py-1 rounded border ${picked.includes(tr) ? "bg-blue-50 border-blue-300 text-blue-800" : "bg-white border-slate-200 text-slate-500"}`}>
                  {tr}{!covered.has(tr) && <span className="text-rose-600 ml-1">未登録</span>}
                </button>
              ))}
            </div>
          </div>
          <Btn kind="primary"><Radar size={12} />候補を集める</Btn>
        </div>
        <p className="text-xs text-slate-400 mt-2 leading-relaxed">
          収集元は、行政が公開する許可・登録業者名簿、公開された落札情報、業界団体の会員名簿。社名と所在地を取得したうえで、公式サイトで事業内容と連絡先を裏取りします。
          名簿の購入や個人連絡先の収集は行いません。既存の協力会社と除外リストは自動で突き合わせます。
        </p>
      </Panel>

      <Panel title={`候補（${shown.length}）`} dense>
        <div className="ai-scroll">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-500"><tr className="text-left">
              <th className="px-3 py-2 font-medium">会社</th><th className="px-2 py-2 font-medium">業種</th>
              <th className="px-2 py-2 font-medium">見つけた根拠</th><th className="px-2 py-2 font-medium">連絡手段</th>
              <th className="px-2 py-2 font-medium text-right">確度</th><th className="px-2 py-2 font-medium">状況</th><th className="px-2 py-2" />
            </tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} className="border-t border-slate-100 align-top">
                  <td className="px-3 py-2">
                    <button onClick={() => setOpenId(r.id === openId ? null : r.id)} className="font-medium hover:underline text-left">{r.name}</button>
                    <div className="text-slate-500">{r.area}／{r.tel}</div>
                    <div className="text-slate-400 break-all">{r.web}</div>
                  </td>
                  <td className="px-2 py-2"><Pill>{r.trade}</Pill></td>
                  <td className="px-2 py-2 text-slate-600">{r.source}<div className="text-slate-400">{r.note}</div></td>
                  <td className="px-2 py-2">
                    {r.channel === "メール" ? <Pill tone="blue"><Mail size={11} />メール</Pill> : <Pill tone="amber">フォームのみ</Pill>}
                    {r.channel !== "メール" && <div className="text-slate-400 mt-0.5">担当者が送信</div>}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{Math.round(r.conf * 100)}%</td>
                  <td className="px-2 py-2"><Pill tone={tone[r.state]}>{r.state}</Pill></td>
                  <td className="px-2 py-2 text-right whitespace-nowrap">
                    <div className="inline-flex gap-1">
                      {r.state === "未送信" && <Btn size="sm" kind="primary" onClick={() => onSend(r.id)}><Send size={12} />{r.channel === "メール" ? "送信" : "文面をコピー"}</Btn>}
                      {r.state === "送信済" && <>
                        <Btn size="sm" onClick={() => onReply(r.id, true)}>返信：前向き</Btn>
                        <Btn size="sm" onClick={() => onReply(r.id, false)}>返信：対応不可</Btn>
                      </>}
                      {r.state === "返信あり（前向き）" && <Btn size="sm" kind="primary" onClick={() => onRegister(r.id)}>協力会社に登録</Btn>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      {open && (
        <Panel title={`${open.name} の記録`} right={<Btn size="sm" onClick={() => setOpenId(null)}>閉じる</Btn>}>
          {(open.history ?? []).length === 0 ? <p className="text-xs text-slate-500">まだ連絡していません。</p> : (
            <ol className="space-y-2">
              {open.history.map((h, i) => (
                <li key={i} className="flex gap-2 text-xs">
                  <span className="text-slate-400 tabular-nums w-16 shrink-0">{h.at}</span>
                  <Pill tone={h.kind === "返信" ? "green" : h.kind === "除外" ? "rose" : h.kind === "登録" ? "violet" : "blue"}>{h.kind}</Pill>
                  <span className="text-slate-700 min-w-0">{h.text}</span>
                </li>
              ))}
            </ol>
          )}
          <p className="text-xs text-slate-400 mt-3">
            送信は1社1通です。返信がない会社を追いかけることはしません（具体的な案件が出たときに1通だけ送ります）。
          </p>
        </Panel>
      )}

      <Panel title="送る文面" right={
        <div className="flex gap-1">
          {[["mail", "初回メール"], ["form", "フォーム用（短縮）"]].map(([k, l]) => (
            <button key={k} onClick={() => setTpl(k)}
              className={`text-xs px-2 py-1 rounded border ${tpl === k ? "bg-slate-800 text-white border-slate-800" : "bg-white border-slate-200 text-slate-600"}`}>{l}</button>
          ))}
        </div>}>
        <pre className="text-xs text-slate-700 leading-relaxed whitespace-pre-wrap border-l-2 border-slate-200 pl-3 m-0" style={{ fontFamily: "inherit" }}>
{tpl === "mail" ? mailText : formText}
        </pre>
        <p className="text-xs text-slate-400 mt-2">
          {tpl === "mail"
            ? "メールには送信者の名称・住所・連絡先と、配信停止の案内を自動で付けます。"
            : "問い合わせフォームは自動送信しません。規約で営業目的の送信を禁じているサイトが多いため、この文面をコピーして担当者が送ります。"}
        </p>
      </Panel>

      {excluded.length > 0 && (
        <Panel title={`除外リスト（${excluded.length}）`}>
          <p className="text-xs text-slate-600 leading-relaxed">
            断られた会社です。今後の候補収集から自動で除外され、二度と送信されません。
          </p>
          <ul className="space-y-1.5 mt-2">
            {excluded.map((r) => (
              <li key={r.id} className="text-xs flex flex-wrap items-center gap-2">
                <span className="font-medium">{r.name}</span><Pill>{r.trade}</Pill>
                <span className="text-slate-500">{r.excludeReason}</span>
                <button onClick={() => onRestore(r.id)} className="text-blue-800 underline ml-auto">除外を解除</button>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {added.length > 0 && (
        <Panel title={`今回登録した会社（${added.length}）`}>
          <ul className="space-y-1">
            {added.map((a) => (
              <li key={a.id} className="text-xs flex flex-wrap gap-2">
                <span className="font-medium">{a.name}</span><Pill>{a.trades[0]}</Pill><span className="text-slate-500">{a.base}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}

/* =============================================================================
   協力会社に届く画面（回収率を上げるための、相手側の体験）
============================================================================= */
function PartnerSideView({ tenders, quotes }) {
  const t = tenders.find((x) => x.id === "T-2026-000842") ?? tenders[0];
  const lots = (t.lots ?? []).filter((l) => l.trade === "清掃");
  const [amount, setAmount] = useState("");
  const [sent, setSent] = useState(false);
  return (
    <div className="space-y-3">
      <Panel title="協力会社にはこう見えます">
        <p className="text-xs text-slate-600 leading-relaxed">
          見積が集まるかどうかは、頼まれた側の手間で決まります。協力会社は入札のことを知りませんし、資料も読みたくありません。
          必要なのは「自分の担当分の数量」と「いつまでにいくらか」だけです。届く画面はそれだけにしています。
        </p>
      </Panel>

      <div className="ai-cols ai-cols-2">
        <Panel title="① LINE・メールで届くもの">
          <div className="border border-slate-200 rounded p-3 bg-slate-50">
            <div className="text-xs text-slate-500">{COMPANY.name} より</div>
            <p className="text-xs text-slate-800 mt-1.5 leading-relaxed">
              いつもお世話になっております。<br />
              下記の見積をお願いします。御社の担当分（清掃）の数量のみお送りします。<br /><br />
              件名：{t.name}<br />
              場所：{t.place}<br />
              期間：{t.termFrom}〜{t.termTo}<br />
              <span className="font-semibold">回答期限：2026/08/04 17:00</span><br /><br />
              下のリンクから、金額を入れて送信するだけで完了します。<br />
              対応が難しい場合は「今回は見送る」を押してください。
            </p>
            <div className="mt-2"><Pill tone="green"><MessageSquare size={11} />LINEで送信</Pill></div>
          </div>
          <p className="text-xs text-slate-400 mt-2">添付は数量表の該当行のみ。仕様書・公告は送りません。</p>
        </Panel>

        <Panel title="② リンクを開くと（協力会社の回答画面）">
          <div className="border-2 border-slate-300 rounded p-3">
            <div className="text-xs font-semibold">{t.name}</div>
            <div className="text-xs text-slate-500 mt-0.5">担当：清掃／回答期限 2026/08/04 17:00</div>
            <table className="w-full text-xs mt-2">
              <thead className="bg-slate-50 text-slate-500"><tr className="text-left">
                <th className="px-2 py-1.5 font-medium">項目</th><th className="px-2 py-1.5 font-medium">仕様</th><th className="px-2 py-1.5 font-medium text-right">数量</th>
              </tr></thead>
              <tbody>
                {lots.map((l) => (
                  <tr key={l.no} className="border-t border-slate-100">
                    <td className="px-2 py-1.5 font-medium">{l.item}</td>
                    <td className="px-2 py-1.5 text-slate-600">{l.spec}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{l.qty} {l.unit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {sent ? (
              <div className="mt-3 border border-emerald-200 bg-emerald-50 rounded p-2.5">
                <div className="text-xs font-semibold text-emerald-800 flex items-center gap-1.5"><CheckCircle2 size={13} />送信しました</div>
                <p className="text-xs text-emerald-900 mt-1">{yen(Number(amount))} で受け付けました。結果が出たらご連絡します。</p>
              </div>
            ) : (
              <>
                <label className="block text-xs mt-3">
                  <span className="text-slate-500">見積金額（税抜）</span>
                  <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="例：17250000"
                    className="mt-1 w-full text-sm border border-slate-300 rounded px-2 py-2 tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-300" />
                </label>
                <label className="block text-xs mt-2">
                  <span className="text-slate-500">補足（任意）</span>
                  <input placeholder="例：夜間帯6名で計上" className="mt-1 w-full text-xs border border-slate-300 rounded px-2 py-1.5" />
                </label>
                <div className="flex flex-wrap gap-2 mt-3">
                  <Btn kind="primary" disabled={!amount} onClick={() => setSent(true)}>この金額で送信する</Btn>
                  <Btn onClick={() => setSent(true)}>今回は見送る</Btn>
                </div>
                <p className="text-xs text-slate-400 mt-2">ログイン不要。1分で終わります。</p>
              </>
            )}
          </div>
        </Panel>
      </div>

      <Panel title="なぜここまで削るのか">
        <ul className="space-y-1.5">
          {[
            "資料を丸ごと送ると、協力会社は自分の担当範囲を探すところから始めることになり、返信が遅れます。",
            "ログインを要求すると回答率が落ちます。リンクを開いて金額を入れるだけにします。",
            "「見送る」を押しやすくしておくと、放置されずに済みます。誰が対応できないかが早く分かるほど、次の会社に回せます。",
            "回答の速さと採用率は自動で記録され、次の依頼先の推薦に反映されます。",
          ].map((x) => <li key={x} className="text-xs text-slate-700 flex gap-2"><span className="text-slate-400">・</span>{x}</li>)}
        </ul>
      </Panel>
    </div>
  );
}

/* =============================================================================
   はじめかた（初期設定）
============================================================================= */
function StartView({ tenders, quotes, onView, onOpen }) {
  const steps = setupSteps(tenders, quotes);
  const done = steps.filter((x) => x.done).length;
  const target = tenders.find((t) => t.proposal && t.proposal.state !== "対象外");
  return (
    <div className="space-y-3">
      <Panel title="はじめかた" right={<span className="text-xs text-slate-500 tabular-nums">{done}/{steps.length} 完了</span>}>
        <Bar v={(done / steps.length) * 100} tone="bg-emerald-500" />
        <p className="text-xs text-slate-600 mt-2 leading-relaxed">
          入札が初めてでも大丈夫です。ここの設定さえ終われば、あとは毎朝届く案件を上から順に進めるだけになります。
          分からない言葉には点線が引いてあります。カーソルを合わせると説明が出ます。
        </p>
      </Panel>

      <Panel dense>
        <div className="p-3">
          {steps.map((s, i) => (
            <div key={s.k} className="ai-step">
              <div className="pt-0.5">{s.done ? <CheckCircle2 size={16} className="text-emerald-600" /> : <Circle size={16} className="text-slate-300" />}</div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`text-xs font-semibold ${s.done ? "text-slate-500" : "text-slate-900"}`}>{i + 1}. {s.label}</span>
                  {s.done ? <Pill tone="green">完了</Pill> : <Pill tone="amber">未設定</Pill>}
                </div>
                <p className="text-xs text-slate-500 mt-1 leading-relaxed">{s.why}</p>
                <div className="flex flex-wrap items-center gap-2 mt-1.5">
                  <span className="text-xs text-slate-600">{s.detail}</span>
                  <button onClick={() => onView(s.go)} className="text-xs text-blue-800 underline">{s.done ? "確認する" : "設定する"}</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="入札の流れ（全体像）">
        <ol className="ai-cols ai-cols-3">
          {[
            ["1. 案件が届く", "AIが毎朝、公告を集めて解析し、参加できる案件だけを届けます。"],
            ["2. 参加を決める", "資格・等級・地域は自動で照合済み。足りない条件があれば表示されます。"],
            ["3. 資料を正式に取得", "参加するには御社名義での取得が必要です。手順を案内します。"],
            ["4. 見積を集める", "必要な業種をAIが判断し、協力会社へ依頼します。返信は自動で取り込まれます。"],
            ["5. 価格を決める", "原価を集計し、同じ品目の落札率から目安を出します。"],
            ["6. 書類を出す", "必要書類のチェックリストどおりに揃えて提出します。"],
          ].map(([t, d]) => (
            <li key={t} className="border border-slate-200 rounded p-2.5 bg-slate-50">
              <div className="text-xs font-semibold">{t}</div>
              <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{d}</p>
            </li>
          ))}
        </ol>
        {target && (
          <div className="mt-3 flex flex-wrap gap-2 items-center">
            <span className="text-xs text-slate-600">まずは1件、進め方を見てみてください。</span>
            <Btn kind="primary" onClick={() => onOpen(target.id, "guide")}><ListChecks size={12} />{target.name}</Btn>
          </div>
        )}
      </Panel>

      <Panel title="よくあるつまずき">
        <ul className="space-y-2">
          {[
            ["提出期限と開札日を混同する", "提出期限までに書類を出し、開札日に結果が出ます。期限ボードでは両方を分けて表示しています。"],
            ["質問期限を逃す", "公告で分からない点を聞ける締切は、提出期限より前です。AIが質問案を作るので、送るか決めるだけです。"],
            ["システムが取った資料で参加できると思う", "入札に参加するには御社名義での正式取得が必要な案件があります。案件詳細に必ず表示しています。"],
            ["書類が1つ足りずに失格", "提出書類チェックリストがすべて完了になるまで、提出済みにできない仕組みにしています。"],
          ].map(([q, a]) => (
            <li key={q}>
              <div className="text-xs font-semibold flex gap-1.5"><AlertTriangle size={12} className="text-amber-600 mt-0.5 shrink-0" />{q}</div>
              <p className="text-xs text-slate-600 mt-0.5 leading-relaxed pl-5">{a}</p>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

/* =============================================================================
   資料をさがす（案件横断の全文検索）
============================================================================= */
function SearchView({ tenders, onOpen }) {
  const [q, setQ] = useState("");
  const [past, setPast] = useState(true);
  const hits = useMemo(() => {
    if (q.trim() === "") return [];
    const k = q.trim();
    const out = [];
    tenders.filter((t) => past || t.collect !== "終了").forEach((t) => {
      const found = [];
      if (t.name.includes(k)) found.push({ where: "案件名", text: t.name });
      if (t.analysis?.summary?.includes(k)) found.push({ where: "要約", text: t.analysis.summary });
      (t.analysis?.quals ?? []).forEach((x) => x.includes(k) && found.push({ where: "参加資格", text: x }));
      (t.analysis?.conditions ?? []).forEach((x) => x.includes(k) && found.push({ where: "参加条件", text: x }));
      (t.analysis?.notes ?? []).forEach((x) => x.includes(k) && found.push({ where: "注意事項", text: x }));
      (t.lots ?? []).forEach((l) => (l.item.includes(k) || (l.spec ?? "").includes(k)) && found.push({ where: `数量表 ${l.no}行目`, text: `${l.item}／${l.spec}（${l.qty}${l.unit}）` }));
      (t.forms ?? []).forEach((x) => (x.name.includes(k) || (x.note ?? "").includes(k)) && found.push({ where: "提出書類", text: `${x.name}${x.note ? "／" + x.note : ""}` }));
      if (found.length) out.push({ t, found });
    });
    return out;
  }, [q, past, tenders]);

  const mark = (text) => {
    const i = text.indexOf(q);
    if (i < 0 || !q) return text;
    return (<>{text.slice(0, i)}<span className="bg-amber-100 font-semibold">{text.slice(i, i + q.length)}</span>{text.slice(i + q.length)}</>);
  };

  return (
    <div className="space-y-3">
      <Panel title="資料をさがす">
        <p className="text-xs text-slate-600 leading-relaxed">
          取得した公告・仕様書・数量表・提出書類の中身を横断して検索します。
          「前に似た案件をやったはず」を思い出すための機能です。過去の案件ほど価格や体制の参考になります。
        </p>
        <div className="mt-2 flex flex-wrap gap-2 items-center">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="例：貯水槽、機械警備、マニフェスト、履行実績調書"
            className="text-xs border border-slate-300 rounded px-2 py-1.5 w-64 focus:outline-none focus:ring-2 focus:ring-blue-300" />
          <label className="text-xs flex items-center gap-1.5 text-slate-600">
            <input type="checkbox" checked={past} onChange={(e) => setPast(e.target.checked)} className="accent-blue-800" />終了した案件も含める
          </label>
        </div>
        <div className="flex flex-wrap gap-1 mt-2">
          {["貯水槽", "機械警備", "マニフェスト", "履行実績調書", "OCR"].map((w) => (
            <button key={w} onClick={() => setQ(w)} className="text-xs px-2 py-0.5 rounded border border-slate-200 text-slate-600 hover:bg-slate-50">{w}</button>
          ))}
        </div>
      </Panel>

      {q && (
        <Panel title={`検索結果（${hits.length}件の案件）`}>
          {hits.length === 0 ? <p className="text-xs text-slate-500">該当する記載は見つかりませんでした。</p> : (
            <ul className="space-y-3">
              {hits.map(({ t, found }) => (
                <li key={t.id}>
                  <div className="flex flex-wrap items-center gap-2">
                    <button onClick={() => onOpen(t.id)} className="text-xs font-semibold hover:underline">{t.name}</button>
                    <CollectPill s={t.collect} />
                    {t.award && <Pill tone={t.award.winner === "自社" ? "green" : "slate"}>{t.award.winner === "自社" ? "落札" : "失注"} {yen(t.award.amount)}</Pill>}
                  </div>
                  <ul className="mt-1 space-y-1">
                    {found.slice(0, 4).map((f, i) => (
                      <li key={i} className="text-xs text-slate-700 flex gap-2">
                        <span className="text-slate-400 shrink-0 w-24">{f.where}</span>
                        <span className="min-w-0">{mark(f.text)}</span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}
    </div>
  );
}
