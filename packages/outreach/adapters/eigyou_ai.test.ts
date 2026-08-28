import { describe, expect, it, vi, afterEach } from "vitest";
import {
  createTargetList,
  createTenant,
  getQuotaStatus,
  listRepliedMembers,
  OutreachError,
  previewTargets,
  purchaseQuota,
  sendTargetList,
  setSenderIdentity,
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

describe("createTenant", () => {
  it("本部の運用キーでPOSTし、テナントIDとAPIキーを返す", async () => {
    const spy = mockFetch(200, { ok: true, tenant_id: 77, api_key: "new-tenant-key" });
    const result = await createTenant(opsConnection, { name: "山田電気株式会社", senderEmail: "info@yamada.example" });
    expect(result).toEqual({ tenantId: 77, apiKey: "new-tenant-key" });
    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://sales.example.com/api/ops/tenants");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer ops-key-456");
    expect(JSON.parse(init.body as string)).toEqual({ name: "山田電気株式会社", sender_email: "info@yamada.example" });
  });

  it("任意項目(sender_name/sender_address/optout_url)も渡せる", async () => {
    const spy = mockFetch(200, { ok: true, tenant_id: 77, api_key: "new-tenant-key" });
    await createTenant(opsConnection, {
      name: "山田電気株式会社",
      senderEmail: "info@yamada.example",
      senderName: "山田電気",
      senderAddress: "東京都千代田区1-1-1",
      optoutUrl: "https://example.com/optout",
    });
    const [, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      name: "山田電気株式会社",
      sender_email: "info@yamada.example",
      sender_name: "山田電気",
      sender_address: "東京都千代田区1-1-1",
      optout_url: "https://example.com/optout",
    });
  });

  it("会社名か送信元メールアドレスが空なら呼びに行かない", async () => {
    const spy = mockFetch(200, {});
    await expect(createTenant(opsConnection, { name: " ", senderEmail: "a@example.com" })).rejects.toThrow(OutreachError);
    await expect(createTenant(opsConnection, { name: "山田電気", senderEmail: " " })).rejects.toThrow(OutreachError);
    expect(spy).not.toHaveBeenCalled();
  });

  it("APIキーが返らなければ0にせず止める", async () => {
    mockFetch(200, { ok: true, tenant_id: 77 });
    await expect(
      createTenant(opsConnection, { name: "山田電気株式会社", senderEmail: "info@yamada.example" }),
    ).rejects.toMatchObject({ code: "PARSE_INVALID" });
  });

  it("重複などの営業AI側のエラーはそのまま止める", async () => {
    mockFetch(400, { error: "sender_emailの形式が正しくありません" });
    await expect(
      createTenant(opsConnection, { name: "山田電気株式会社", senderEmail: "info@yamada.example" }),
    ).rejects.toMatchObject({ code: "OUT_OF_SCOPE" });
  });
});

describe("setSenderIdentity", () => {
  const senderInput = {
    templateName: "本部設定（顧客名義）",
    senderName: "山田電気株式会社",
    senderEmail: "info@yamada.example",
    senderAddress: "東京都千代田区1-1-1",
  };

  it("登録してから有効化する(2回POSTする)", async () => {
    const spy = vi.fn(async (url: string) => {
      if (url.endsWith("/api/tenant/sender-templates")) {
        return new Response(JSON.stringify({ ok: true, template_id: 9 }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    vi.stubGlobal("fetch", spy);

    const result = await setSenderIdentity(connection, senderInput);
    expect(result).toEqual({ templateId: 9 });
    expect(spy).toHaveBeenCalledTimes(2);
    const [addUrl, addInit] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(addUrl).toBe("https://sales.example.com/api/tenant/sender-templates");
    expect(JSON.parse(addInit.body as string)).toMatchObject({
      name: "本部設定（顧客名義）",
      sender_name: "山田電気株式会社",
      sender_email: "info@yamada.example",
      sender_address: "東京都千代田区1-1-1",
    });
    const [activateUrl, activateInit] = spy.mock.calls[1] as unknown as [string, RequestInit];
    expect(activateUrl).toBe("https://sales.example.com/api/tenant/sender-templates/activate");
    expect(JSON.parse(activateInit.body as string)).toEqual({ template_id: 9 });
  });

  it("姓・名・フリガナ・住所内訳・電話番号も渡せる", async () => {
    const spy = vi.fn(async () => new Response(JSON.stringify({ ok: true, template_id: 9 }), { status: 200 }));
    vi.stubGlobal("fetch", spy);
    await setSenderIdentity(connection, {
      ...senderInput,
      lastName: "山田",
      firstName: "太郎",
      lastNameKana: "ヤマダ",
      firstNameKana: "タロウ",
      postalCode: "100-0001",
      prefecture: "東京都",
      city: "千代田区",
      block: "1-1",
      building: "3F",
      phone: "03-1234-5678",
      department: "営業部",
      position: "部長",
    });
    const [, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({
      last_name: "山田",
      first_name: "太郎",
      last_name_kana: "ヤマダ",
      first_name_kana: "タロウ",
      postal_code: "100-0001",
      prefecture: "東京都",
      city: "千代田区",
      block: "1-1",
      building: "3F",
      phone: "03-1234-5678",
      department: "営業部",
      position: "部長",
    });
  });

  it("送信元名か送信元メールアドレスが空なら呼びに行かない", async () => {
    const spy = mockFetch(200, {});
    await expect(setSenderIdentity(connection, { ...senderInput, senderName: " " })).rejects.toThrow(OutreachError);
    await expect(setSenderIdentity(connection, { ...senderInput, senderEmail: " " })).rejects.toThrow(OutreachError);
    expect(spy).not.toHaveBeenCalled();
  });

  it("登録でエラーが返ったら止める(有効化は呼ばない)", async () => {
    const spy = mockFetch(200, { error: "name・sender_name・sender_emailは必須です" });
    await expect(setSenderIdentity(connection, senderInput)).rejects.toMatchObject({ code: "OUT_OF_SCOPE" });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("登録は成功したが有効化でエラーが返ったら、その旨を伝えて止める", async () => {
    const spy = vi.fn(async (url: string) => {
      if (url.endsWith("/api/tenant/sender-templates")) {
        return new Response(JSON.stringify({ ok: true, template_id: 9 }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "テンプレートが見つかりません" }), { status: 200 });
    });
    vi.stubGlobal("fetch", spy);
    await expect(setSenderIdentity(connection, senderInput)).rejects.toMatchObject({ code: "OUT_OF_SCOPE" });
  });
});

describe("listRepliedMembers", () => {
  it("GETでstatus=repliedを付けて呼び、会社の配列を返す", async () => {
    const spy = mockFetch(200, {
      list: { id: 7 },
      members: [
        {
          id: 501,
          name: "山田電気株式会社",
          pref: "宮城県",
          phone: "022-123-4567",
          email: "info@yamada.example",
          website_url: "https://yamada.example",
          contact_url: "https://yamada.example/contact",
          replied: 1,
          replied_at: "2026-08-20T10:00:00",
        },
      ],
    });
    const result = await listRepliedMembers(connection, 7);
    expect(result).toEqual([
      {
        companyId: 501,
        name: "山田電気株式会社",
        pref: "宮城県",
        phone: "022-123-4567",
        email: "info@yamada.example",
        websiteUrl: "https://yamada.example",
        contactUrl: "https://yamada.example/contact",
        repliedAt: "2026-08-20T10:00:00",
      },
    ]);
    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://sales.example.com/api/tenant/lists/7?status=replied");
    expect(init.method).toBe("GET");
  });

  it("空文字の項目はnullにする(社名不明は既定文言)", async () => {
    mockFetch(200, { members: [{ id: 502, name: "", pref: "", phone: "", email: "", website_url: "", contact_url: "", replied_at: "" }] });
    const result = await listRepliedMembers(connection, 7);
    expect(result).toEqual([
      { companyId: 502, name: "（社名不明）", pref: null, phone: null, email: null, websiteUrl: null, contactUrl: null, repliedAt: null },
    ]);
  });

  it("membersが無ければ空配列", async () => {
    mockFetch(200, { list: { id: 7 } });
    expect(await listRepliedMembers(connection, 7)).toEqual([]);
  });

  it("会社IDが読めない行があれば止める", async () => {
    mockFetch(200, { members: [{ name: "山田電気" }] });
    await expect(listRepliedMembers(connection, 7)).rejects.toMatchObject({ code: "PARSE_INVALID" });
  });

  it("営業AIがerrorを返したら止める", async () => {
    mockFetch(404, { error: "リストが見つかりません" });
    await expect(listRepliedMembers(connection, 999)).rejects.toMatchObject({ code: "OUT_OF_SCOPE" });
  });
});
