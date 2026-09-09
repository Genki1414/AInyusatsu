import { describe, expect, it } from "vitest";
import { elapsedLabel, HEARTBEAT_MINUTES, workerHealth } from "./worker_health";

const NOW = new Date("2026-09-09T20:30:00+09:00");
const minutesBefore = (n: number) => new Date(NOW.getTime() - n * 60000).toISOString();

describe("workerHealth", () => {
  it("合図が新しければ正常", () => {
    expect(workerHealth(minutesBefore(3), NOW).state).toBe("正常");
  });

  it("合図が1回飛んだくらいでは赤くしない（赤が当たり前になると誰も見なくなる）", () => {
    expect(workerHealth(minutesBefore(HEARTBEAT_MINUTES + 5), NOW).state).toBe("正常");
    expect(workerHealth(minutesBefore(HEARTBEAT_MINUTES * 2), NOW).state).toBe("正常");
  });

  it("2回続けて飛んだら異常として扱う", () => {
    expect(workerHealth(minutesBefore(HEARTBEAT_MINUTES * 2 + 1), NOW).state).toBe("遅れています");
  });

  it("1時間を超えたら止まっているとみなす", () => {
    expect(workerHealth(minutesBefore(61), NOW).state).toBe("止まっています");
    expect(workerHealth(minutesBefore(60 * 24 * 6), NOW).state).toBe("止まっています");
  });

  it("止まっているときは、何が止まっているかと次にやることを書く", () => {
    const health = workerHealth(minutesBefore(60 * 24), NOW);
    expect(health.detail).toContain("収集");
    expect(health.detail).toContain("Railway");
  });

  it("一度も動いていない場合は「未起動」", () => {
    for (const value of [null, undefined, ""]) {
      expect(workerHealth(value, NOW).state).toBe("未起動");
      expect(workerHealth(value, NOW).minutesAgo).toBeNull();
    }
  });

  it("時刻が読めなければ「未起動」（推測しない）", () => {
    expect(workerHealth("きのう", NOW).state).toBe("未起動");
  });

  it("未来の時刻でもマイナスを出さない（時計のずれ）", () => {
    const future = new Date(NOW.getTime() + 5 * 60000).toISOString();
    const health = workerHealth(future, NOW);
    expect(health.minutesAgo).toBe(0);
    expect(health.state).toBe("正常");
  });

  it("経過分を返す", () => {
    expect(workerHealth(minutesBefore(37), NOW).minutesAgo).toBe(37);
  });
});

describe("elapsedLabel", () => {
  it("経過を日本語にする", () => {
    expect(elapsedLabel(0)).toBe("たった今");
    expect(elapsedLabel(37)).toBe("37分前");
    expect(elapsedLabel(120)).toBe("2時間前");
    expect(elapsedLabel(60 * 24 * 6)).toBe("6日前");
  });

  it("記録が無ければそう書く", () => {
    expect(elapsedLabel(null)).toBe("記録がありません");
  });
});
