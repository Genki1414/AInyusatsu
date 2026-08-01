// 発注機関名から agencies テーブルの安定したidを導出する。副作用を持たない純関数。
// GEPS・KKJなど複数のソースから同じ機関名（正規化後は同一）が得られた場合に、
// 同じagency_idへ収束させるため、コネクタ非依存の共通ロジックとして切り出している。

import { createHash } from "node:crypto";
import { normalize } from "./dedupe";

/**
 * 機関名からagenciesテーブルの安定したid（決定的ハッシュ）を導出する。
 * tenders.agency_idはNOT NULLの外部キーだが、機関マスタ（機関マスタ_v2.md）は
 * 手作業でのキュレーション対象であり全機関を事前に網羅できない。そのため、
 * 機関マスタに無い機関は、コネクタ側でこのidを使って自動的にagenciesへ登録する運用にする。
 */
export function agencyIdFromName(agencyName: string): string {
  const hash = createHash("sha1").update(normalize(agencyName), "utf8").digest("hex").slice(0, 12);
  return `auto-${hash}`;
}
