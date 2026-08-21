// AI解析プロンプト集.md §4「提出書類の抽出」の出力スキーマ。
import { z } from "zod";
import { evidencedField, evidenceShape, maybe } from "./common";

export const formsSchema = z.object({
  forms: z
    .array(
      z.object({
        name: z.string(),
        form_no: maybe(z.string()),
        // 必須かどうかを資料から判断できない場合は null が返る（§全体ルール1）。
        // §4は「迷ったら含める（人が消す方が、漏れて失格になるより安全）」という再現率優先の
        // 方針なので、保存時は必須扱いに寄せる（tender_forms.required は not null default true）。
        required: maybe(z.boolean()),
        note: maybe(z.string()),
        ...evidenceShape,
      }),
    )
    .default([]),
  submission_method: evidencedField(maybe(z.string())),
  unknown_reason: maybe(z.string()),
});

export type Forms = z.infer<typeof formsSchema>;
