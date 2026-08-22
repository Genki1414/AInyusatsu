import { describe, expect, it, vi } from "vitest";
import { activeSchedule, parseDisabledJobs, SCHEDULE, TIMEZONE } from "./schedule";

describe("SCHEDULE", () => {
  it("ジョブ名が重複していない（重複すると片方のスケジュールが消える）", () => {
    expect(new Set(SCHEDULE.map((j) => j.name)).size).toBe(SCHEDULE.length);
  });

  it("cronは5フィールドで書かれている", () => {
    for (const job of SCHEDULE) {
      expect(job.cron.trim().split(/\s+/), `${job.name} の cron: ${job.cron}`).toHaveLength(5);
    }
  });

  it("すべてのジョブに説明がある（起動時のログで何が動くか分かるように）", () => {
    expect(SCHEDULE.every((j) => j.description.length > 0)).toBe(true);
  });

  it("時刻は日本時間で解釈する", () => {
    expect(TIMEZONE).toBe("Asia/Tokyo");
  });

  it("巡回はKKJの同期より後に走る（同期で見つけた案件を拾うため）", () => {
    const kkj = SCHEDULE.find((j) => j.name === "kkj-sync")!;
    const crawl = SCHEDULE.find((j) => j.name === "crawl-geps")!;
    expect(minuteOf(kkj.cron)).toBeLessThan(minuteOf(crawl.cron));
  });

  it("テキスト抽出→AI解析→提案の順に並んでいる", () => {
    const at = (name: string) => hourOf(SCHEDULE.find((j) => j.name === name)!.cron);
    expect(at("extract-text")).toBeLessThan(at("analyze-pending"));
    expect(at("analyze-pending")).toBeLessThan(at("match-tenders"));
  });

  it("提案の直前に公開・終了が反映される（期限切れを提案しない／解析結果をその日のうちに載せる）", () => {
    const lifecycleHours = hoursOf(job("tender-lifecycle").cron);
    for (const matchHour of hoursOf(job("match-tenders").cron)) {
      expect(
        lifecycleHours.some((h) => h < matchHour && matchHour - h <= 1),
        `${matchHour}時の提案の直前に tender-lifecycle が走っていません`,
      ).toBe(true);
    }
  });

  it("公開・終了は毎日走る（仕様書 §5 close は毎日00:30）", () => {
    expect(hoursOf(job("tender-lifecycle").cron)).toContain(0);
  });
});

/** ジョブを名前で引く。 */
function job(name: string) {
  const found = SCHEDULE.find((j) => j.name === name);
  if (!found) throw new Error(`スケジュールに ${name} がありません`);
  return found;
}

/** cronの2番目（時）をすべて数値で返す。「0,10,18」なら [0, 10, 18]。 */
function hoursOf(cron: string): number[] {
  return cron.split(/\s+/)[1].split(",").map(Number);
}

/** cronの先頭（分）を数値で返す。 */
function minuteOf(cron: string): number {
  return Number(cron.split(/\s+/)[0]);
}

/** cronの2番目（時）の最初の値を返す。「8,16」なら8。 */
function hourOf(cron: string): number {
  return Number(cron.split(/\s+/)[1].split(",")[0]);
}

describe("parseDisabledJobs", () => {
  it("カンマ区切りのジョブ名を読む", () => {
    expect([...parseDisabledJobs("analyze-pending,crawl-geps")]).toEqual(["analyze-pending", "crawl-geps"]);
  });

  it("前後の空白を許す", () => {
    expect([...parseDisabledJobs(" analyze-pending , crawl-geps ")]).toEqual(["analyze-pending", "crawl-geps"]);
  });

  it("未設定・空文字なら何も止めない", () => {
    expect(parseDisabledJobs(undefined).size).toBe(0);
    expect(parseDisabledJobs("").size).toBe(0);
  });

  it("知らないジョブ名は無視するが、黙って捨てずに警告する（打ち間違いに気づけるように）", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(parseDisabledJobs("analyze,crawl-geps").size).toBe(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("analyze"));
    warn.mockRestore();
  });
});

describe("activeSchedule", () => {
  it("止める指定のジョブを除く", () => {
    const active = activeSchedule(parseDisabledJobs("analyze-pending"));
    expect(active).toHaveLength(SCHEDULE.length - 1);
    expect(active.some((j) => j.name === "analyze-pending")).toBe(false);
  });

  it("何も止めなければ全部返す", () => {
    expect(activeSchedule(new Set())).toHaveLength(SCHEDULE.length);
  });
});
