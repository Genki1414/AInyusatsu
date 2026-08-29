import { describe, expect, it } from "vitest";
import {
  canOutreach,
  formatTradeMap,
  maskApiKey,
  parseTradeMap,
  prefectureFromPlace,
  salesAiSetupState,
  summarizeOutreachSend,
  toSalesAiTrade,
  validateProvisionTenant,
  validateSalesAiSettings,
  type OutreachSendCounts,
  type SalesAiSetupInput,
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

describe("salesAiSetupState", () => {
  const done: SalesAiSetupInput = {
    baseUrl: "https://sales.example.com",
    hasKey: true,
    tradeCount: 3,
    checkedAt: "2026-08-28T00:00:00+09:00",
    checkError: null,
  };

  it("URLもキーも無ければ未設定", () => {
    expect(salesAiSetupState({ ...done, baseUrl: null, hasKey: false })).toBe("未設定");
  });

  it("キーだけ無くても未設定（URLだけでは呼べない）", () => {
    expect(salesAiSetupState({ ...done, hasKey: false })).toBe("未設定");
  });

  it("URLだけ無くても未設定", () => {
    expect(salesAiSetupState({ ...done, baseUrl: "  " })).toBe("未設定");
  });

  it("対応表が空なら、どの業種でもボタンが出ないので分けて出す", () => {
    expect(salesAiSetupState({ ...done, tradeCount: 0 })).toBe("対応表が空");
  });

  it("確認していなければ未確認", () => {
    expect(salesAiSetupState({ ...done, checkedAt: null })).toBe("未確認");
  });

  it("失敗の記録が残っていれば、確認済みでも確認に失敗", () => {
    expect(salesAiSetupState({ ...done, checkError: "UNREACHABLE：つながりません" })).toBe("確認に失敗");
  });

  it("揃っていれば設定済み", () => {
    expect(salesAiSetupState(done)).toBe("設定済み");
  });
});

describe("canOutreach", () => {
  it("設定済みなら探せる", () => {
    expect(canOutreach("設定済み")).toBe(true);
  });

  it("未確認でも探せる（確認していないだけで設定は揃っている）", () => {
    expect(canOutreach("未確認")).toBe(true);
  });

  it("前回の確認に失敗していても止めない（一時的な失敗のことがある）", () => {
    expect(canOutreach("確認に失敗")).toBe(true);
  });

  it("未設定と対応表が空のときは探せない", () => {
    expect(canOutreach("未設定")).toBe(false);
    expect(canOutreach("対応表が空")).toBe(false);
  });
});

describe("summarizeOutreachSend", () => {
  const zero: OutreachSendCounts = {
    requested: 0, sent: 0, failed: 0, blocked: 0, suppressed: 0, stopped: 0,
    cancelledRecent: 0, dryRun: false,
  };

  it("全部送れたら件数だけを出す", () => {
    const r = summarizeOutreachSend({ ...zero, requested: 12, sent: 12 });
    expect(r.message).toBe("12社へ送信しました。");
    expect(r.nothingSent).toBe(false);
    expect(r.hasRemaining).toBe(false);
  });

  it("送り残しがあることを隠さない（営業AIは1回50社までしか送らない）", () => {
    const r = summarizeOutreachSend({ ...zero, requested: 120, sent: 50, failed: 70 });
    expect(r.message).toContain("50社へ送信しました");
    expect(r.message).toContain("残り70社はまだ送れていません");
    expect(r.message).toContain("もう一度");
    expect(r.hasRemaining).toBe(true);
    expect(r.nothingSent).toBe(false);
  });

  it("1社も送れていなければ成功として見せない", () => {
    const r = summarizeOutreachSend({ ...zero, requested: 8, sent: 0, stopped: 8 });
    expect(r.message).toContain("1社にも送信できませんでした");
    expect(r.message).toContain("送信が停止されている");
    expect(r.nothingSent).toBe(true);
  });

  it("ドライランで返ってきたら、送信しましたとは書かない", () => {
    const r = summarizeOutreachSend({ ...zero, requested: 10, sent: 10, dryRun: true });
    expect(r.message).toContain("1社にも届いていません");
    expect(r.nothingSent).toBe(true);
  });

  it("直近に送った会社が外れたことを伝える", () => {
    const r = summarizeOutreachSend({ ...zero, requested: 5, sent: 5, cancelledRecent: 3 });
    expect(r.message).toContain("直近に送ったばかりの3社");
  });

  it("配信停止と送信失敗の内訳を出す", () => {
    const r = summarizeOutreachSend({ ...zero, requested: 10, sent: 4, blocked: 2, failed: 4 });
    expect(r.message).toContain("配信停止・除外設定により2社");
    expect(r.message).toContain("送信できず4社");
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

// 送信元（顧客名義）の入力・検証（旧validateSenderIdentity）は
// mailing_identity.test.ts の normalizeMailingIdentity/combineAddress に移した。
