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
const USER = { cachedPrefix: "資料の本文", body: "【出力するJSON】" };

describe("extract", () => {
  it("1回目でスキーマに適合すれば、その結果を返す", async () => {
    const callModel = vi.fn().mockResolvedValue('{"value":"ok"}');
    const result = await extract({ promptName: "test", system: "s", user: USER, schema, callModel });
    expect(result).toEqual({ value: "ok" });
    expect(callModel).toHaveBeenCalledTimes(1);
  });

  it("1回目が不正でも、2回目で適合すればその結果を返す", async () => {
    const callModel = vi
      .fn()
      .mockResolvedValueOnce("not json")
      .mockResolvedValueOnce('{"value":"ok"}');
    const onInvalid = vi.fn();
    const result = await extract({ promptName: "test", system: "s", user: USER, schema, callModel, onInvalid });
    expect(result).toEqual({ value: "ok" });
    expect(callModel).toHaveBeenCalledTimes(2);
    expect(onInvalid).toHaveBeenCalledTimes(1);
    expect(onInvalid).toHaveBeenCalledWith(expect.objectContaining({ promptName: "test", attempt: 1 }));
  });

  it("2回とも不正ならParseInvalidErrorを投げる", async () => {
    const callModel = vi.fn().mockResolvedValue("not json");
    const onInvalid = vi.fn();
    await expect(
      extract({ promptName: "test", system: "s", user: USER, schema, callModel, onInvalid }),
    ).rejects.toThrow(ParseInvalidError);
    expect(callModel).toHaveBeenCalledTimes(2);
    expect(onInvalid).toHaveBeenCalledTimes(2);
  });

  it("JSONとしては妥当でもスキーマに違反していれば再試行する", async () => {
    const callModel = vi.fn().mockResolvedValue('{"value":123}'); // valueはstringのはずが数値
    await expect(extract({ promptName: "test", system: "s", user: USER, schema, callModel })).rejects.toThrow(
      ParseInvalidError,
    );
    expect(callModel).toHaveBeenCalledTimes(2);
  });
});

describe("safeJsonParse（制御文字の混入）", () => {
  it("引用の中に生の改行が入っていても読める（内容は変えない）", () => {
    // モデルは資料からの引用に改行をそのまま入れてくることがある（実機で発生）。
    const raw = '{"quote": "1行目\n2行目", "source": "公告 1"}';
    const parsed = safeJsonParse(raw) as { quote: string; source: string };
    expect(parsed.quote).toBe("1行目\n2行目");
    expect(parsed.source).toBe("公告 1");
  });

  it("タブ・復帰も読める", () => {
    const parsed = safeJsonParse('{"quote": "列1\t列2\r次"}') as { quote: string };
    expect(parsed.quote).toBe("列1\t列2\r次");
  });

  it("コードフェンス付きで、かつ制御文字が入っていても読める", () => {
    const parsed = safeJsonParse('```json\n{"quote": "a\nb"}\n```') as { quote: string };
    expect(parsed.quote).toBe("a\nb");
  });

  it("文字列の外にある改行（通常の整形）はこれまでどおり読める", () => {
    const parsed = safeJsonParse('{\n  "a": 1,\n  "b": 2\n}') as { a: number; b: number };
    expect(parsed).toEqual({ a: 1, b: 2 });
  });

  it("エスケープ済みの引用符を文字列の終わりと誤認しない", () => {
    const parsed = safeJsonParse('{"quote": "彼は\\"はい\\"と言った", "n": 1}') as { quote: string; n: number };
    expect(parsed.quote).toBe('彼は"はい"と言った');
    expect(parsed.n).toBe(1);
  });

  it("JSONとして壊れている場合は従来どおり例外になる", () => {
    expect(() => safeJsonParse('{"a": ')).toThrow();
  });
});

describe("extract（トークン消費の受け渡し）", () => {
  it("onUsageに、プロンプト名と試行回数を添えて渡す", async () => {
    const usage = { inputTokens: 100, cacheCreationTokens: 7000, cacheReadTokens: 0, outputTokens: 50 };
    const callModel = vi.fn().mockImplementation(async (args) => {
      args.onUsage?.(usage);
      return '{"value":"ok"}';
    });
    const onUsage = vi.fn();
    await extract({ promptName: "basic_info", system: "s", user: USER, schema, callModel, onUsage });
    expect(onUsage).toHaveBeenCalledWith({ ...usage, promptName: "basic_info", attempt: 1 });
  });

  it("再試行したぶんもトークン消費として渡す（2回分が課金される）", async () => {
    const usage = { inputTokens: 100, cacheCreationTokens: 0, cacheReadTokens: 7000, outputTokens: 50 };
    const callModel = vi
      .fn()
      .mockImplementationOnce(async (args) => {
        args.onUsage?.(usage);
        return "not json";
      })
      .mockImplementationOnce(async (args) => {
        args.onUsage?.(usage);
        return '{"value":"ok"}';
      });
    const onUsage = vi.fn();
    await extract({ promptName: "lots", system: "s", user: USER, schema, callModel, onUsage });
    expect(onUsage).toHaveBeenCalledTimes(2);
    expect(onUsage).toHaveBeenLastCalledWith(expect.objectContaining({ attempt: 2 }));
  });

  it("onUsageを渡さなければ、callModelにも渡さない", async () => {
    const callModel = vi.fn().mockResolvedValue('{"value":"ok"}');
    await extract({ promptName: "test", system: "s", user: USER, schema, callModel });
    expect(callModel).toHaveBeenCalledWith(expect.objectContaining({ onUsage: undefined }));
  });
});
