import { describe, expect, it } from "vitest";
import { dateOnly, dedupeKey, normalize } from "./dedupe";

describe("normalize", () => {
  it("空白（半角・全角・複数連続）を除去して統一する", () => {
    const a = normalize("東京第3合同庁舎 建物清掃業務");
    const b = normalize("東京第3合同庁舎　建物清掃業務"); // 全角スペース
    const c = normalize("東京第3合同庁舎  建物清掃業務"); // 半角スペース2つ
    expect(a).toBe(b);
    expect(a).toBe(c);
  });

  it("全角/半角の英数字を統一する", () => {
    expect(normalize("Ａ棟清掃業務２０２６")).toBe(normalize("A棟清掃業務2026"));
  });

  it("括弧とその中身を除去して統一する", () => {
    const withNote = normalize("東京第3合同庁舎 建物清掃業務（単年度）");
    const withoutNote = normalize("東京第3合同庁舎 建物清掃業務");
    expect(withNote).toBe(withoutNote);
  });

  it("様々な括弧の種類を除去する", () => {
    const base = normalize("清掃業務");
    expect(normalize("清掃業務(税込)")).toBe(base);
    expect(normalize("清掃業務[再公告]")).toBe(base);
    expect(normalize("清掃業務【再公告】")).toBe(base);
    expect(normalize("清掃業務〔再公告〕")).toBe(base);
    expect(normalize("清掃業務「再公告」")).toBe(base);
    expect(normalize("清掃業務『再公告』")).toBe(base);
  });

  it("年度表記（令和/R/西暦）を西暦に統一する", () => {
    const reiwa = normalize("令和8年度 清掃業務委託");
    const rAbbrev = normalize("R8年度　清掃業務委託");
    const western = normalize("2026年度清掃業務委託");
    expect(reiwa).toBe(rAbbrev);
    expect(reiwa).toBe(western);
  });

  it("表記ゆれが複合していても同一になる", () => {
    const a = normalize("〇〇税務署　庁舎清掃業務（令和8年度・単年度）");
    const b = normalize("〇〇税務署 庁舎清掃業務(R8年度・単年度)");
    expect(a).toBe(b);
  });
});

describe("dateOnly", () => {
  it("JSTの日付を返す（UTC日付とJST日付がずれる境界を確認）", () => {
    // 2026-08-07T17:00:00Z は JST では 2026-08-08 02:00
    expect(dateOnly("2026-08-07T17:00:00Z")).toBe("2026-08-08");
  });

  it("Dateオブジェクトでも同じ結果になる", () => {
    expect(dateOnly(new Date("2026-08-07T17:00:00Z"))).toBe("2026-08-08");
  });

  it("null・undefined・不正な値はnull", () => {
    expect(dateOnly(null)).toBeNull();
    expect(dateOnly(undefined)).toBeNull();
    expect(dateOnly("not-a-date")).toBeNull();
  });
});

describe("dedupeKey", () => {
  const submitDeadline = "2026-08-07T15:00:00+09:00";

  it("notice_noがある場合は agency_id/notice_no/date になる", () => {
    const key = dedupeKey({
      agencyId: "mof-kanto",
      noticeNo: "2026-0731-014",
      name: "東京第3合同庁舎 建物清掃業務",
      submitDeadline,
    });
    expect(key).toBe("mof-kanto/2026-0731-014/2026-08-07");
  });

  it("notice_noがある場合、nameが違っても同じキーになる", () => {
    const a = dedupeKey({ agencyId: "mof-kanto", noticeNo: "N-1", name: "案件A", submitDeadline });
    const b = dedupeKey({ agencyId: "mof-kanto", noticeNo: "N-1", name: "案件B", submitDeadline });
    expect(a).toBe(b);
  });

  it("notice_noが無い場合は agency_id/sha1(normalize(name))/date になり、40文字のhex", () => {
    const key = dedupeKey({
      agencyId: "mof-kanto",
      noticeNo: null,
      name: "東京第3合同庁舎 建物清掃業務",
      submitDeadline,
    });
    const [agencyId, hash, date] = key.split("/");
    expect(agencyId).toBe("mof-kanto");
    expect(hash).toMatch(/^[0-9a-f]{40}$/);
    expect(date).toBe("2026-08-07");
  });

  it("notice_noが無い場合、表記ゆれのある同一案件は同じキーになる", () => {
    const base = {
      agencyId: "mof-kanto",
      noticeNo: null as string | null,
      submitDeadline,
    };
    const keyA = dedupeKey({ ...base, name: "東京第3合同庁舎　建物清掃業務（単年度）" });
    const keyB = dedupeKey({ ...base, name: "東京第3合同庁舎 建物清掃業務(令和8年度)" });
    const keyC = dedupeKey({ ...base, name: "東京第３合同庁舎  建物清掃業務  [R8年度]" });
    expect(keyA).toBe(keyB);
    expect(keyA).toBe(keyC);
  });

  it("notice_noが空文字の場合はnotice_no無し扱いになる", () => {
    const withEmpty = dedupeKey({ agencyId: "a", noticeNo: "", name: "案件", submitDeadline });
    const withNull = dedupeKey({ agencyId: "a", noticeNo: null, name: "案件", submitDeadline });
    expect(withEmpty).toBe(withNull);
  });

  it("agency_idが違えば別キーになる", () => {
    const a = dedupeKey({ agencyId: "mof-kanto", noticeNo: "N-1", name: "案件", submitDeadline });
    const b = dedupeKey({ agencyId: "mof-tohoku", noticeNo: "N-1", name: "案件", submitDeadline });
    expect(a).not.toBe(b);
  });

  it("notice_noが違えば別キーになる", () => {
    const a = dedupeKey({ agencyId: "mof-kanto", noticeNo: "N-1", name: "案件", submitDeadline });
    const b = dedupeKey({ agencyId: "mof-kanto", noticeNo: "N-2", name: "案件", submitDeadline });
    expect(a).not.toBe(b);
  });

  it("提出期限の日付が違えば別キーになる（時刻だけが違う場合は同じ）", () => {
    const sameDay1 = dedupeKey({ agencyId: "a", noticeNo: "N-1", name: "x", submitDeadline: "2026-08-07T09:00:00+09:00" });
    const sameDay2 = dedupeKey({ agencyId: "a", noticeNo: "N-1", name: "x", submitDeadline: "2026-08-07T18:00:00+09:00" });
    const otherDay = dedupeKey({ agencyId: "a", noticeNo: "N-1", name: "x", submitDeadline: "2026-08-08T09:00:00+09:00" });
    expect(sameDay1).toBe(sameDay2);
    expect(sameDay1).not.toBe(otherDay);
  });

  it("提出期限が無い場合は日付部分がunknownになる", () => {
    const key = dedupeKey({ agencyId: "a", noticeNo: "N-1", name: "案件", submitDeadline: null });
    expect(key).toBe("a/N-1/unknown");
  });
});
