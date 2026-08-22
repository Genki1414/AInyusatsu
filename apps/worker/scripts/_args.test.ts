import { describe, expect, it } from "vitest";
import { CliUsageError, rejectExtraArgs, requireDateIso, requirePositiveInt } from "./_args";

const USAGE = "pnpm --filter worker kkj:sync [-- YYYY-MM-DD]";

describe("requireDateIso", () => {
  it("YYYY-MM-DD をそのまま返す", () => {
    expect(requireDateIso("2026-08-22", "公告日")).toBe("2026-08-22");
  });

  it("読めない値は使い方の誤りとして止める", () => {
    expect(() => requireDateIso("2026/08/22", "公告日")).toThrow(CliUsageError);
    expect(() => requireDateIso("2026-02-30", "公告日")).toThrow(CliUsageError);
  });

  it("受け取った値をメッセージに含める（何が渡ったか分かるように）", () => {
    // Windowsのコマンドプロンプトは "#" 以降をコメントにしないため、実際にこの値が渡る
    expect(() => requireDateIso("#", "公告日")).toThrow('受け取った値: "#"');
  });
});

describe("requirePositiveInt", () => {
  it("1以上の整数を返す", () => {
    expect(requirePositiveInt("24", "対象月数")).toBe(24);
    expect(requirePositiveInt("1", "対象月数")).toBe(1);
  });

  it("0・負の値・小数・数値でない値は止める", () => {
    for (const bad of ["0", "-1", "1.5", "にじゅうよん", "#"]) {
      expect(() => requirePositiveInt(bad, "対象月数"), bad).toThrow(CliUsageError);
    }
  });
});

describe("rejectExtraArgs", () => {
  it("想定の数までは通す", () => {
    expect(() => rejectExtraArgs([], 0, USAGE)).not.toThrow();
    expect(() => rejectExtraArgs(["2026-08-22"], 1, USAGE)).not.toThrow();
  });

  it("多すぎたら止める", () => {
    expect(() => rejectExtraArgs(["#", "説明文"], 1, USAGE)).toThrow(CliUsageError);
  });

  it("Windowsでコメントが引数になることを案内する", () => {
    // 手順をコピーして `pnpm ... kkj:sync  # 説明` と貼る事故を、その場で気づけるようにする
    expect(() => rejectExtraArgs(["#", "説明文"], 0, USAGE)).toThrow("コメントになりません");
  });

  it("受け取った引数をすべて見せる", () => {
    expect(() => rejectExtraArgs(["#", "説明文"], 0, USAGE)).toThrow('"#" "説明文"');
  });
});
