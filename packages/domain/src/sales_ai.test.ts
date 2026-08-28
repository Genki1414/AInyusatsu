import { describe, expect, it } from "vitest";
import {
  formatTradeMap,
  maskApiKey,
  parseTradeMap,
  prefectureFromPlace,
  toSalesAiTrade,
  validateProvisionTenant,
  validateSalesAiSettings,
  validateSenderIdentity,
} from "./sales_ai";

describe("parseTradeMap", () => {
  it("1行1件で読む", () => {
    const result = parseTradeMap("電気 = denki\n清掃=seisou");
    expect(result).toEqual({ ok: true, value: { 電気: "denki", 清掃: "seisou" } });
  });

  it("空行と # の行は読み飛ばす", () => {
    const result = parseTradeMap("# メモ\n\n電気 = denki\n");
    expect(result).toEqual({ ok: true, value: { 電気: "denki" } });
  });

  it("= が無い行は誤りとして止める", () => {
    const result = parseTradeMap("電気 denki");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("1行目");
  });

  it("片方だけの行は誤りとして止める", () => {
    expect(parseTradeMap("電気 = ").ok).toBe(false);
    expect(parseTradeMap(" = denki").ok).toBe(false);
  });

  it("同じ業種が2回出てきたら止める（どちらが効くか分からないため）", () => {
    const result = parseTradeMap("電気 = denki\n電気 = electric");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("2回");
  });

  it("書いた形に戻せる", () => {
    const parsed = parseTradeMap("電気 = denki\n清掃 = seisou");
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(formatTradeMap(parsed.value)).toBe("電気 = denki\n清掃 = seisou");
  });
});

describe("toSalesAiTrade", () => {
  it("対応があれば業種コードを返す", () => {
    expect(toSalesAiTrade({ 電気: "denki" }, "電気")).toBe("denki");
    expect(toSalesAiTrade({ 電気: "denki" }, " 電気 ")).toBe("denki");
  });

  it("対応が無ければ null（この業種では候補を探させない）", () => {
    // 営業AIは知らない業種の値を黙って捨てる。捨てられるとその県の全社が対象になる
    expect(toSalesAiTrade({ 電気: "denki" }, "警備")).toBeNull();
    expect(toSalesAiTrade({ 電気: "  " }, "電気")).toBeNull();
  });
});

describe("validateSalesAiSettings", () => {
  const valid = { baseUrl: "https://sales.example.com/", apiKey: "key-123", tradeMapText: "電気 = denki" };

  it("通ったら末尾のスラッシュを落とす", () => {
    const result = validateSalesAiSettings(valid);
    expect(result).toEqual({
      ok: true,
      value: { baseUrl: "https://sales.example.com", apiKey: "key-123", tradeMap: { 電気: "denki" } },
    });
  });

  it("http は通さない（APIキーを平文で送らないため）", () => {
    const result = validateSalesAiSettings({ ...valid, baseUrl: "http://sales.example.com" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("https");
  });

  it("URLとAPIキーは必須", () => {
    expect(validateSalesAiSettings({ ...valid, baseUrl: "  " }).ok).toBe(false);
    expect(validateSalesAiSettings({ ...valid, apiKey: "  " }).ok).toBe(false);
    expect(validateSalesAiSettings({ ...valid, baseUrl: "sales.example.com" }).ok).toBe(false);
  });

  it("対応表の誤りはそのまま伝える", () => {
    const result = validateSalesAiSettings({ ...valid, tradeMapText: "電気 denki" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("1行目");
  });

  it("対応表は空でもよい（先に接続だけ設定できる）", () => {
    const result = validateSalesAiSettings({ ...valid, tradeMapText: "" });
    expect(result.ok).toBe(true);
  });
});

describe("maskApiKey", () => {
  it("末尾だけ残す", () => {
    expect(maskApiKey("abcdefgh1234")).toBe("••••••••1234");
  });

  it("未設定と短すぎる値は伏せない形にしない", () => {
    expect(maskApiKey(null)).toBe("未設定");
    expect(maskApiKey("abc")).toBe("未設定");
  });
});

describe("prefectureFromPlace", () => {
  it("履行場所から都道府県を取り出す", () => {
    expect(prefectureFromPlace("宮城県仙台市青葉区")).toBe("宮城県");
    expect(prefectureFromPlace("東京都千代田区霞が関")).toBe("東京都");
    expect(prefectureFromPlace("北海道釧路市")).toBe("北海道");
  });

  it("取り出せなければ null（推測で別の県を入れない）", () => {
    expect(prefectureFromPlace(null)).toBeNull();
    expect(prefectureFromPlace("当事務所会議室")).toBeNull();
  });
});

describe("validateProvisionTenant", () => {
  it("会社名とメールアドレスを確かめる", () => {
    const result = validateProvisionTenant({ orgName: " 山田電気 ", senderEmail: " Sales@Example.co.jp " });
    expect(result).toEqual({ ok: true, value: { orgName: "山田電気", senderEmail: "sales@example.co.jp" } });
  });

  it("会社名が空なら止める", () => {
    const result = validateProvisionTenant({ orgName: " ", senderEmail: "a@example.com" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("会社名");
  });

  it("メールアドレスの形でなければ止める", () => {
    const result = validateProvisionTenant({ orgName: "山田電気", senderEmail: "not-an-email" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("メールアドレス");
  });
});

describe("validateSenderIdentity", () => {
  it("必須(送信元名・メール)だけでも通り、未入力の任意項目は空文字になる", () => {
    const result = validateSenderIdentity({ senderName: "山田電気株式会社", senderEmail: "info@yamada.example" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.senderName).toBe("山田電気株式会社");
      expect(result.value.senderEmail).toBe("info@yamada.example");
      expect(result.value.templateName).toBe("本部設定（顧客名義）");
      expect(result.value.lastName).toBe("");
      expect(result.value.phone).toBe("");
    }
  });

  it("姓・名・フリガナ・郵便番号・住所・電話番号もそのまま渡る", () => {
    const result = validateSenderIdentity({
      senderName: "山田電気株式会社",
      senderEmail: "info@yamada.example",
      lastName: "山田",
      firstName: "太郎",
      lastNameKana: "ヤマダ",
      firstNameKana: "タロウ",
      postalCode: "100-0001",
      prefecture: "東京都",
      city: "千代田区千代田",
      block: "1-1",
      building: "皇居ビル3F",
      phone: "03-1234-5678",
      department: "営業部",
      position: "部長",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.lastName).toBe("山田");
      expect(result.value.prefecture).toBe("東京都");
      expect(result.value.phone).toBe("03-1234-5678");
    }
  });

  it("送信元名が空なら止める", () => {
    const result = validateSenderIdentity({ senderName: " ", senderEmail: "info@yamada.example" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("送信元名");
  });

  it("送信元メールが空、または形が不正なら止める", () => {
    expect(validateSenderIdentity({ senderName: "山田電気", senderEmail: " " }).ok).toBe(false);
    expect(validateSenderIdentity({ senderName: "山田電気", senderEmail: "not-an-email" }).ok).toBe(false);
  });
});
