// 自社の郵送名義まわりの純ロジック（T55の続き）。
//
// 【誰の名義か】
// 協力会社開拓の問い合わせフォームに載る送信元＝契約者本人の名義
// （AI入札部自身のアドレスにはしない。ユーザー決定 2026-08-28）。
// 会社名・送信元メールは organizations.name / reply_to をそのまま使うので、
// ここで扱うのは住所・電話番号・氏名など、営業AIのsender-templatesが持つ
// それ以外の項目だけ（1行1件の必須項目は無い＝全部任意）。

export type MailingIdentityInput = {
  lastName?: string;
  firstName?: string;
  lastNameKana?: string;
  firstNameKana?: string;
  postalCode?: string;
  prefecture?: string;
  city?: string;
  block?: string;
  building?: string;
  phone?: string;
  department?: string;
  position?: string;
};

/** 全項目trimしただけの値。空欄はそのまま空文字列にする（nullにはしない。DB更新の都合上）。 */
export function normalizeMailingIdentity(input: Record<string, string | undefined>): MailingIdentityInput {
  const keys: (keyof MailingIdentityInput)[] = [
    "lastName",
    "firstName",
    "lastNameKana",
    "firstNameKana",
    "postalCode",
    "prefecture",
    "city",
    "block",
    "building",
    "phone",
    "department",
    "position",
  ];
  const value: MailingIdentityInput = {};
  for (const key of keys) {
    value[key] = (input[key] ?? "").trim();
  }
  return value;
}

/** 都道府県・市区町村・丁目番地・建物名をつなげて、単一欄向けの住所にする。 */
export function combineAddress(parts: { prefecture?: string; city?: string; block?: string; building?: string }): string {
  return [parts.prefecture, parts.city, parts.block, parts.building]
    .map((part) => (part ?? "").trim())
    .filter((part) => part !== "")
    .join("");
}

/** 住所・電話番号など、送信元として最低限の体裁が整っているか（空でも入力を止めはしない目安）。 */
export function mailingIdentityLooksComplete(identity: MailingIdentityInput): boolean {
  return Boolean(identity.postalCode && identity.prefecture && identity.city && identity.phone);
}
