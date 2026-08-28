import { describe, expect, it, vi, afterEach } from "vitest";
import {
  createTargetList,
  getQuotaStatus,
  OutreachError,
  previewTargets,
  purchaseQuota,
  sendTargetList,
} from "./eigyou_ai";

const connection = { baseUrl: "https://sales.example.com/", apiKey: "key-123" };
const opsConnection = { baseUrl: "https://sales.example.com/", opsApiKey: "ops-key-456" };
const filters = { prefs: ["宮城県"], trades: ["denki"] };
const quotaPayload = {
  base_monthly_send_quota: 500,
  addon_quota_30d: 0,
  effective_quota_30d: 500,
  used_30d: 120,
  remaining_30d: 380,
  plan_name: null,
};

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
  // 営業AI側 target_lists.send_list() の実際の応答形。トップレベルに sent/count/requested は無い
  const realResponse = {
    campaign_id: 99,
    target_count: 12,
    dry_run: false,
    stats: { sent: 10, failed: 1, blocked: 1, suppressed: 0, stopped: 0 },
    cancelled_recent: 0,
  };

  it("dry_run を false にして送信を頼む", async () => {
    const spy = mockFetch(200, realResponse);
    const result = await sendTargetList(connection, 7, { subject: "件名", body: "本文" });
    expect(result).toEqual({
      requested: 12,
      stats: { sent: 10, failed: 1, blocked: 1, suppressed: 0, stopped: 0 },
      note: null,
    });
    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://sales.example.com/api/tenant/lists/7/send");
    expect(JSON.parse(init.body as string)).toMatchObject({ dry_run: false, subject: "件名", body: "本文" });
  });

  it("件名か本文が空なら呼びに行かない", async () => {
    const spy = mockFetch(200, {});
    await expect(sendTargetList(connection, 7, { subject: " ", body: "本文" })).rejects.toThrow(OutreachError);
    await expect(sendTargetList(connection, 7, { subject: "件名", body: " " })).rejects.toThrow(OutreachError);
    expect(spy).not.toHaveBeenCalled();
  });

  it("以前のトップレベルのsent/count/requestedしか無い応答は読めず止める(修正前の実際のバグの再現)", async () => {
    mockFetch(200, { sent: 12 });
    await expect(sendTargetList(connection, 7, { subject: "件名", body: "本文" })).rejects.toMatchObject({
      code: "PARSE_INVALID",
    });
  });

  it("target_countが返らなければ0にせず止める", async () => {
    mockFetch(200, { ok: true });
    await expect(sendTargetList(connection, 7, { subject: "件名", body: "本文" })).rejects.toMatchObject({
      code: "PARSE_INVALID",
    });
  });

  it("statsが返らなければ止める", async () => {
    mockFetch(200, { target_count: 5 });
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

describe("getQuotaStatus", () => {
  it("GETでBearer認証して残り送信可能数を返す", async () => {
    const spy = mockFetch(200, { quota: quotaPayload });
    const result = await getQuotaStatus(connection);
    expect(result).toEqual({
      baseMonthlyQuota: 500,
      addonQuota30d: 0,
      effectiveQuota30d: 500,
      used30d: 120,
      remaining30d: 380,
      planName: null,
    });
    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://sales.example.com/api/tenant/quota");
    expect(init.method).toBe("GET");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer key-123");
  });

  it("quotaが返らなければ止める", async () => {
    mockFetch(200, {});
    await expect(getQuotaStatus(connection)).rejects.toMatchObject({ code: "PARSE_INVALID" });
  });

  it("認証の失敗は AUTH_REQUIRED", async () => {
    mockFetch(401, {});
    await expect(getQuotaStatus(connection)).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
  });
});

describe("purchaseQuota", () => {
  it("本部の運用キーでPOSTし、テナントIDをURLに含める", async () => {
    const spy = mockFetch(200, {
      ok: true,
      created: true,
      purchase: { id: 1, tenant_id: 42, qty: 500 },
      quota: { ...quotaPayload, addon_quota_30d: 500, effective_quota_30d: 1000 },
    });
    const result = await purchaseQuota(opsConnection, 42, { qty: 500, unitPriceYen: 5000, externalRef: "pi_abc" });
    expect(result).toEqual({
      created: true,
      quota: {
        baseMonthlyQuota: 500,
        addonQuota30d: 500,
        effectiveQuota30d: 1000,
        used30d: 120,
        remaining30d: 380,
        planName: null,
      },
    });
    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://sales.example.com/api/ops/tenants/42/quota-purchase");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer ops-key-456");
    expect(JSON.parse(init.body as string)).toEqual({ qty: 500, unit_price_yen: 5000, external_ref: "pi_abc" });
  });

  it("同じexternal_refで二重に呼んでもcreated:falseがそのまま返る(冪等性は営業AI側)", async () => {
    mockFetch(200, { ok: true, created: false, purchase: {}, quota: quotaPayload });
    const result = await purchaseQuota(opsConnection, 42, { qty: 500, externalRef: "pi_abc" });
    expect(result.created).toBe(false);
  });

  it("qtyが正の整数でなければ呼びに行かない", async () => {
    const spy = mockFetch(200, {});
    await expect(purchaseQuota(opsConnection, 42, { qty: 0 })).rejects.toThrow(OutreachError);
    await expect(purchaseQuota(opsConnection, 42, { qty: -1 })).rejects.toThrow(OutreachError);
    await expect(purchaseQuota(opsConnection, 42, { qty: 1.5 })).rejects.toThrow(OutreachError);
    expect(spy).not.toHaveBeenCalled();
  });

  it("存在しないテナント等、営業AIがerrorを返したら止める", async () => {
    mockFetch(404, { error: "テナントが見つかりません" });
    await expect(purchaseQuota(opsConnection, 999, { qty: 500 })).rejects.toMatchObject({ code: "OUT_OF_SCOPE" });
  });
});
