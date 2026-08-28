// スキーマの見本が「引用は無い」と教えていないかを見張る。
//
// 【なぜこのテストがあるか】
// basic_info の見本が全17項目で `"quote": null, "source": null` になっていた。
// システムプロンプトは「すべての抽出項目に引用と出典を付ける」と書いてあるのに、
// 見本のほうが「null」と示していたため、資料によっては値だけを返し、引用を
// 返さなかった（実データ20件中4〜5件）。
//
// 引用の無い抽出は「未確認」として扱う（CLAUDE.md 最重要の前提3）ので、
// 引用が返らないと、正しく取れている値まで使えない扱いになる。

import { describe, expect, it } from "vitest";
import { BASIC_INFO_SCHEMA_DESCRIPTION } from "./basic_info";
import { FORMS_SCHEMA_DESCRIPTION } from "./forms";
import { LOTS_SCHEMA_DESCRIPTION } from "./lots";
import { NOTES_SCHEMA_DESCRIPTION } from "./notes";
import { QUALIFICATIONS_SCHEMA_DESCRIPTION } from "./qualifications";
import { QUESTIONS_SCHEMA_DESCRIPTION } from "./questions";

const DESCRIPTIONS = {
  basic_info: BASIC_INFO_SCHEMA_DESCRIPTION,
  forms: FORMS_SCHEMA_DESCRIPTION,
  lots: LOTS_SCHEMA_DESCRIPTION,
  notes: NOTES_SCHEMA_DESCRIPTION,
  qualifications: QUALIFICATIONS_SCHEMA_DESCRIPTION,
  questions: QUESTIONS_SCHEMA_DESCRIPTION,
};

describe("スキーマの見本", () => {
  for (const [name, description] of Object.entries(DESCRIPTIONS)) {
    it(`${name}: quote / source の見本を null にしない`, () => {
      expect(description).not.toMatch(/"quote"\s*:\s*null/);
      expect(description).not.toMatch(/"source"\s*:\s*null/);
    });
  }

  it("basic_info: 期限は時刻なしの日付も返せると示す", () => {
    // 時刻が書かれていない期限に、書かれていない時刻を付けさせないため
    for (const field of ["submit_deadline", "qa_deadline", "bid_open_at"]) {
      const line = BASIC_INFO_SCHEMA_DESCRIPTION.split("\n").find((l) => l.includes(`"${field}"`));
      expect(line, `${field} の行が見つからない`).toBeDefined();
      expect(line).toContain("YYYY-MM-DD|null");
    }
  });
});
