import { describe, expect, it } from "vitest";
import { positiveIntegerFromEnv, splitUrgentCandidates } from "./analyze_batch_cycle";

describe("positiveIntegerFromEnv", () => {
  it("正の整数だけを採用する", () => {
    expect(positiveIntegerFromEnv("120", 50)).toBe(120);
    expect(positiveIntegerFromEnv("0", 50)).toBe(50);
    expect(positiveIntegerFromEnv("-1", 50)).toBe(50);
    expect(positiveIntegerFromEnv("1.5", 50)).toBe(50);
  });
});

describe("splitUrgentCandidates", () => {
  const now = new Date("2026-09-21T00:00:00Z");
  const rows = [
    { id: "urgent", submit_deadline: "2026-09-23T00:00:00Z" },
    { id: "boundary", submit_deadline: "2026-09-24T00:00:00Z" },
    { id: "later", submit_deadline: "2026-09-24T00:00:01Z" },
    { id: "unknown", submit_deadline: null },
    { id: "expired", submit_deadline: "2026-09-20T23:59:59Z" },
  ];

  it("72時間以内だけを緊急にする。未確認・期限切れは通常側へ置く", () => {
    const result = splitUrgentCandidates(rows, now, 72);
    expect(result.urgent.map((row) => row.id)).toEqual(["urgent", "boundary"]);
    expect(result.normal.map((row) => row.id)).toEqual(["later", "unknown", "expired"]);
  });
});
