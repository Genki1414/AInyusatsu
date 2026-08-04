import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { extract, ParseInvalidError, safeJsonParse } from "./extract";

describe("safeJsonParse", () => {
  it("素のJSONをそのままパースする", () => {
    expect(safeJsonParse('{"a":1}')).toEqual({ a: 1 });
  });

  it("```json ... ``` のコードフェンスを取り除いてパースする", () => {
    expect(safeJsonParse('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("```だけのフェンス（言語指定なし）も取り除く", () => {
    expect(safeJsonParse('```\n{"a":1}\n```')).toEqual({ a: 1 });
  });
});

const schema = z.object({ value: z.string() });

describe("extract", () => {
  it("1回目でスキーマに適合すれば、その結果を返す", async () => {
    const callModel = vi.fn().mockResolvedValue('{"value":"ok"}');
    const result = await extract({ promptName: "test", system: "s", user: "u", schema, callModel });
    expect(result).toEqual({ value: "ok" });
    expect(callModel).toHaveBeenCalledTimes(1);
  });

  it("1回目が不正でも、2回目で適合すればその結果を返す", async () => {
    const callModel = vi
      .fn()
      .mockResolvedValueOnce("not json")
      .mockResolvedValueOnce('{"value":"ok"}');
    const onInvalid = vi.fn();
    const result = await extract({ promptName: "test", system: "s", user: "u", schema, callModel, onInvalid });
    expect(result).toEqual({ value: "ok" });
    expect(callModel).toHaveBeenCalledTimes(2);
    expect(onInvalid).toHaveBeenCalledTimes(1);
    expect(onInvalid).toHaveBeenCalledWith(expect.objectContaining({ promptName: "test", attempt: 1 }));
  });

  it("2回とも不正ならParseInvalidErrorを投げる", async () => {
    const callModel = vi.fn().mockResolvedValue("not json");
    const onInvalid = vi.fn();
    await expect(
      extract({ promptName: "test", system: "s", user: "u", schema, callModel, onInvalid }),
    ).rejects.toThrow(ParseInvalidError);
    expect(callModel).toHaveBeenCalledTimes(2);
    expect(onInvalid).toHaveBeenCalledTimes(2);
  });

  it("JSONとしては妥当でもスキーマに違反していれば再試行する", async () => {
    const callModel = vi.fn().mockResolvedValue('{"value":123}'); // valueはstringのはずが数値
    await expect(extract({ promptName: "test", system: "s", user: "u", schema, callModel })).rejects.toThrow(
      ParseInvalidError,
    );
    expect(callModel).toHaveBeenCalledTimes(2);
  });
});
