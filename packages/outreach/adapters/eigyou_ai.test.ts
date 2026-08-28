import { describe, expect, it, vi, afterEach } from "vitest";
import {
  createTargetList,
  DEFAULT_CANCEL_RECENT_DAYS,
  OutreachError,
  previewTargets,
  sendTargetList,
} from "./eigyou_ai";

const connection = { baseUrl: "https://sales.example.com/", apiKey: "key-123" };
const filters = { prefs: ["宮城県"], trades: ["denki"] };

function mockFetch(status: number, body: unknown) {
  const spy = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", spy);
  return spy;
}

afterEach(() => vi.unstubAllGlobals());

describe("previewTargets", () => {
  it("末尾のスラッシュを二重にせず、Bearerで認証する", async () => {
    const spy = mockFetch(200, { count: 12, count_before_cap: 12, capped: false, sample: [] });
    await previewTargets(connection, filters);
    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://sales.example.com/api/tenant/lists/preview");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer key-123");
  });

  it("件数と確認用の数社を返す", async () => {
    mockFetch(200, {
      count: 500,
      count_before_cap: 900,
      capped: true,
      sample: [{ id: 1, name: "山田電気", pref: "宮城県" }, { name: null }],
    });
    const result = await previewTargets(connection, filters);
    expect(result).toEqual({
      count: 500,
      countBeforeCap: 900,
      capped: true,
      sample: [
        { name: "山田電気", pref: "宮城県" },
        { name: "（社名不明）", pref: null },
      ],
    });
  });

  it("業種が空なら呼びに行かない（その県の全社が対象になってしまう）", async () => {
    const spy = mockFetch(200, {});
    await expect(previewTargets(connection, { prefs: ["宮城県"], trades: [] })).rejects.toThrow(OutreachError);
    expect(spy).not.toHaveBeenCalled();
  });

  it("認証の失敗は AUTH_REQUIRED", async () => {
    mockFetch(401, {});
    await expect(previewTargets(connection, filters)).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
  });

  it("回数制限は RATE_LIMITED", async () => {
    mockFetch(429, {});
    await expect(previewTargets(connection, filters)).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });

  it("件数が返らなければ0にせず止める", async () => {
    mockFetch(200, { sample: [] });
    await expect(previewTargets(connection, filters)).rejects.toMatchObject({ code: "PARSE_INVALID" });
  });

  it("つながらないときは UNREACHABLE", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("timeout"); }));
    await expect(previewTargets(connection, filters)).rejects.toMatchObject({ code: "UNREACHABLE" });
  });
});

describe("createTargetList", () => {
  it("リストIDと件数を返す", async () => {
    const spy = mockFetch(200, { list_id: 7, count: 12 });
    const result = await createTargetList(connection, "電気の開拓", filters);
    expect(result).toEqual({ listId: 7, count: 12 });
    const [url] = spy.mock.calls[0] as unknown as [string];
    expect(url).toBe("https://sales.example.com/api/tenant/lists");
  });

  it("営業AIがerrorを返したら止める", async () => {
    mockFetch(200, { error: "指定されたリストが見つかりません" });
    await expect(createTargetList(connection, "電気の開拓", filters)).rejects.toMatchObject({ code: "OUT_OF_SCOPE" });
  });

  it("業種が空なら呼びに行かない", async () => {
    const spy = mockFetch(200, {});
    await expect(createTargetList(connection, "x", { prefs: [], trades: [] })).rejects.toThrow(OutreachError);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("sendTargetList", () => {
  // 営業AIが実際に返す形（eigyouAI target_lists.send_list()）。
  // 以前ここを {sent: 12} という架空の形でモックしていたため、
  // 「送ったのに送れませんでした」と出る不具合をテストが見逃していた。
  const realResponse = {
    campaign_id: 31,
    target_count: 12,
    dry_run: false,
    stats: { sent: 12, failed: 0, blocked: 0, suppressed: 0, stopped: 0 },
    cancelled_recent: 0,
  };

  it("dry_run を false にし、直近に送った会社を外して送信を頼む", async () => {
    const spy = mockFetch(200, realResponse);
    const result = await sendTargetList(connection, 7, { subject: "件名", body: "本文" });
    expect(result).toEqual({
      requested: 12,
      sent: 12,
      failed: 0,
      blocked: 0,
      suppressed: 0,
      stopped: 0,
      cancelledRecent: 0,
      dryRun: false,
    });
    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://sales.example.com/api/tenant/lists/7/send");
    expect(JSON.parse(init.body as string)).toMatchObject({
      dry_run: false,
      subject: "件名",
      body: "本文",
      cancel_recent_days: DEFAULT_CANCEL_RECENT_DAYS,
    });
  });

  it("stats の内訳をそのまま返す（送り残しを画面で出せるように）", async () => {
    mockFetch(200, {
      ...realResponse,
      target_count: 120,
      stats: { sent: 50, failed: 70, blocked: 0, suppressed: 0, stopped: 0 },
      cancelled_recent: 4,
    });
    const result = await sendTargetList(connection, 7, { subject: "件名", body: "本文" });
    expect(result.requested).toBe(120);
    expect(result.sent).toBe(50);
    expect(result.failed).toBe(70);
    expect(result.cancelledRecent).toBe(4);
  });

  it("ドライランで返ってきたらそのまま伝える（成功と混同しない）", async () => {
    mockFetch(200, { ...realResponse, dry_run: true });
    const result = await sendTargetList(connection, 7, { subject: "件名", body: "本文" });
    expect(result.dryRun).toBe(true);
  });

  it("件名か本文が空なら呼びに行かない", async () => {
    const spy = mockFetch(200, {});
    await expect(sendTargetList(connection, 7, { subject: " ", body: "本文" })).rejects.toThrow(OutreachError);
    await expect(sendTargetList(connection, 7, { subject: "件名", body: " " })).rejects.toThrow(OutreachError);
    expect(spy).not.toHaveBeenCalled();
  });

  it("stats.sent が読めなければ0にせず止める", async () => {
    mockFetch(200, { campaign_id: 1, target_count: 3, dry_run: false });
    await expect(sendTargetList(connection, 7, { subject: "件名", body: "本文" })).rejects.toMatchObject({
      code: "PARSE_INVALID",
    });
  });

  it("target_count が読めなければ止める", async () => {
    mockFetch(200, { campaign_id: 1, dry_run: false, stats: { sent: 3 } });
    await expect(sendTargetList(connection, 7, { subject: "件名", body: "本文" })).rejects.toMatchObject({
      code: "PARSE_INVALID",
    });
  });

  it("営業AIがerrorを返したら止める", async () => {
    mockFetch(200, { error: "送信が停止されています" });
    await expect(sendTargetList(connection, 7, { subject: "件名", body: "本文" })).rejects.toMatchObject({
      code: "OUT_OF_SCOPE",
    });
  });
});
