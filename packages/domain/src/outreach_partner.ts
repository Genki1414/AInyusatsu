// 営業AIで打診した会社を、協力会社として登録するときの詰め替え（9月分：協力会社開拓）。
//
// 【なぜここに置くか】
// 営業AI側の列名（phone / pref / contact_url）と、こちらの partners の列名
// （tel / areas / memo）は別物。詰め替えを画面やアクションに散らすと、
// 項目が増えたときに片方だけ直る。純ロジックにしてテストを書く。
//
import { normalizeCompanyName } from "./company_name";

// 【推測で埋めない】
// 取れなかった項目は null のままにする。メールアドレスが無い会社を
// 「メール未登録」として登録し、見積依頼の候補から外れるほうが、
// 適当な値を入れて送信が失敗するより良い（CLAUDE.md「エラーは握りつぶさない」）。

/** 営業AIから返ってきた会社。adapters の OutreachCompany と同じ形。 */
export type OutreachCompanyInput = {
  companyId: number;
  name: string;
  pref: string | null;
  tel: string | null;
  email: string | null;
  contactUrl: string | null;
  websiteUrl: string | null;
};

/** partners へ入れる値。 */
export type PartnerDraft = {
  name: string;
  tel: string | null;
  email: string | null;
  base: string | null;
  trades: string[];
  areas: string[];
  memo: string;
};

/**
 * 協力会社として登録できるか。
 *
 * 社名が無いものは登録させない。あとから見分けがつかなくなる。
 */
export function canRegisterAsPartner(company: OutreachCompanyInput): boolean {
  return company.name.trim() !== "" && company.name.trim() !== "（社名不明）";
}

/**
 * 見積依頼を出せるか。**メールアドレスが要る。**
 *
 * 見積依頼はメールで送るので、アドレスが無い会社は登録できても依頼を出せない。
 * 画面でその違いを出せるように、判定をここに置く。
 */
export function canRequestQuote(company: OutreachCompanyInput): boolean {
  return company.email !== null && company.email.trim() !== "";
}

/**
 * 営業AIの会社を partners の値に詰め替える。
 *
 * memo には「いつ・どの案件で打診して返信をもらったか」を残す。
 * 半年後に一覧を見たとき、どこから来た会社なのか分からないと使えない。
 */
export function toPartnerDraft(
  company: OutreachCompanyInput,
  context: { trade: string; tenderName: string; sentOnLabel: string | null },
): PartnerDraft {
  const lines = [
    `営業AIでの打診に返信をもらって登録しました。`,
    `案件：${context.tenderName}`,
    `業種：${context.trade}`,
  ];
  if (context.sentOnLabel) lines.push(`打診：${context.sentOnLabel}`);
  // 問い合わせページは、メールアドレスが無いときの唯一の連絡手段になる
  if (company.contactUrl) lines.push(`問い合わせページ：${company.contactUrl}`);
  if (company.websiteUrl) lines.push(`サイト：${company.websiteUrl}`);

  return {
    name: company.name.trim(),
    tel: company.tel,
    email: company.email,
    // 所在地は都道府県までしか分からない。それ以上は推測しない
    base: company.pref,
    trades: [context.trade],
    // 都道府県が取れなければ対応地域は空。全国対応とみなさない
    areas: company.pref ? [company.pref] : [],
    memo: lines.join("\n"),
  };
}

/**
 * すでに登録済みの会社か。
 *
 * partners に社名の一意制約は無い。二重に登録すると見積依頼が
 * 同じ会社へ2通行く（相手には嫌がられ、原価集計も狂う）ので、
 * 社名で照合してから入れる。
 *
 * 突き合わせの規則は会社名の共通処理（company_name.ts）に置いてある。
 * 本部が組織の重複を止めるのと同じ規則を使う。
 */
export function findExistingPartner<T extends { id: string; name: string }>(
  partners: T[],
  name: string,
): T | null {
  const target = normalizeCompanyName(name);
  return partners.find((p) => normalizeCompanyName(p.name) === target) ?? null;
}

/**
 * すでに登録済みの会社に、この業種を足すべきか。
 *
 * 同じ会社が別の業種でも返信をくれることがある。行を増やさず業種を足す。
 */
export function tradesAfterAdding(current: string[], trade: string): string[] {
  return current.includes(trade) ? current : [...current, trade];
}
