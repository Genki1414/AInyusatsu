// 会社名の突き合わせ（純ロジック）。
//
// 【どこで使うか】
// - 本部がアカウントを発行するとき、同じ会社が二重に登録されるのを防ぐ
// - 打診した会社を協力会社として登録するとき、二重登録を防ぐ
//
// 【表記ゆれだけを吸収する】
// ㈱・(株)・空白の違いは同じ会社として扱う。
// **それ以上の「似ている」判定はしない。** 別の会社を同じとみなすほうが害が大きい
// （見積依頼が届かない／別の会社の実績が混ざる）。
// 「株式会社山田電機」と「株式会社山田電気」は別の会社のまま。

/** 突き合わせ用に会社名をそろえる。表示には使わない（元の表記をそのまま出す）。 */
export function normalizeCompanyName(name: string): string {
  return name
    .replace(/㈱/g, "株式会社")
    .replace(/㈲/g, "有限会社")
    .replace(/[（(]株[)）]/g, "株式会社")
    .replace(/[（(]有[)）]/g, "有限会社")
    .replace(/[\s　]/g, "")
    .toLowerCase();
}

export function isSameCompanyName(a: string, b: string): boolean {
  return normalizeCompanyName(a) === normalizeCompanyName(b);
}

/**
 * 同じ会社名の組織がすでにあるか。
 *
 * 【なぜ止めるか】
 * 「アカウントを発行する」は**新しい会社**を作るフォーム。
 * 同じ会社の2人目をここで作ると別の組織ができてしまい、
 * 案件も協力会社も見えないアカウントになる（実際に起きた。2026-08-29）。
 * 2人目は「アカウント追加の依頼」から発行する。
 *
 * 同名の別会社が実在することはあるが、まれ。
 * そのときは会社名を少し変えて登録してもらうほうが、
 * 気づかないまま二重の組織ができるより良い。
 */
export function findSameNameOrg<T extends { id: string; name: string }>(
  orgs: T[],
  name: string,
): T | null {
  const target = normalizeCompanyName(name);
  return orgs.find((org) => normalizeCompanyName(org.name) === target) ?? null;
}
