// 常駐ワーカーの実行スケジュール（docs/実装仕様書_v1.md §5 ジョブ設計）。
//
// cron は Asia/Tokyo で書く（pg-boss の schedule に tz を渡す）。UTCに直して書くと
// 夏時間の無い日本でも読み違えやすいので、時刻はそのまま日本時間で持つ。
//
// 【時刻の決め方】
// 巡回は1件あたり数十秒かかり、200件なら2〜3時間になる。仕様書は巡回もテキスト抽出も
// 同じ時刻に置いているが、実際には終わるのを待つ必要があるため後ろにずらしている。
//   04:00 案件の発見（KKJ API）
//   04:30 調達ポータルの巡回・資料取得（〜07:00 ごろ）
//   08:00 テキスト抽出
//   09:00 AI解析
//   10:30 公開・終了の反映
//   11:00 提案の作成
//   07:00 ダイジェストの送信（前日ぶんの提案をまとめて知らせる）
// 12:00の巡回ぶんも拾えるよう、抽出・解析・提案は夕方にもう一度走らせる。

export const TIMEZONE = "Asia/Tokyo";

export type JobName =
  | "kkj-sync"
  | "crawl-geps"
  | "extract-text"
  | "analyze-pending"
  | "tender-lifecycle"
  | "match-tenders"
  | "notify-digest"
  | "coverage-check"
  | "remind-quotes"
  | "import-awards"
  | "refresh-market-rates";

export type ScheduledJob = {
  name: JobName;
  /** Asia/Tokyo の cron 式 */
  cron: string;
  /** 何をするジョブか（起動時のログに出す） */
  description: string;
};

export const SCHEDULE: readonly ScheduledJob[] = [
  { name: "kkj-sync", cron: "0 4,12 * * *", description: "官公需情報ポータルAPIで新規案件を検知する" },
  { name: "crawl-geps", cron: "30 4,12 * * *", description: "調達ポータルを巡回し、資料を取得する" },
  { name: "extract-text", cron: "0 8,16 * * *", description: "取得した資料からテキストを抽出する（必要ならOCR）" },
  { name: "analyze-pending", cron: "0 9,17 * * *", description: "解析待ちの案件をAI解析する" },
  // 仕様書 §5 の close は「毎日 00:30」。ここでは公開も兼ねるため、提案（11:00 / 19:00）の
  // 直前にも走らせる。解析が終わった案件をその日のうちに提案へ乗せるため。
  { name: "tender-lifecycle", cron: "30 0,10,18 * * *", description: "解析完了を公開中にし、提出期限を過ぎた案件を終了にする" },
  { name: "match-tenders", cron: "0 11,19 * * *", description: "条件セットごとに採点し、提案を作る" },
  // 毎朝1通のダイジェスト（実装仕様書 §8）。前日の提案（11:00 / 19:00）をまとめて知らせる。
  // その日の11:00ぶんは翌朝に回る。急ぎの期限は即時通知で拾う想定（未実装）。
  { name: "notify-digest", cron: "0 7 * * *", description: "新着の提案・近い期限・未回答の見積を1通にまとめて送る" },
  { name: "coverage-check", cron: "0 6 * * *", description: "機関ごとに、想定頻度に対して取得できているかを確かめる" },
  { name: "remind-quotes", cron: "0 * * * *", description: "回答期限24時間前の未回答へ催促する" },
  { name: "import-awards", cron: "0 3 1 * *", description: "落札実績オープンデータの差分を取り込む（月次）" },
  { name: "refresh-market-rates", cron: "30 3 1 * *", description: "落札率の集計を作り直す（月次）" },
] as const;

/**
 * 止めたいジョブを環境変数から読む（`DISABLED_JOBS=analyze-pending,crawl-geps`）。
 * 費用のかかるジョブを、コードを触らずに止められるようにしておくための逃げ道。
 * 知らない名前が入っていたら、黙って無視せず警告する（打ち間違いに気づけるように）。
 */
export function parseDisabledJobs(raw: string | undefined): Set<JobName> {
  const known = new Set<string>(SCHEDULE.map((job) => job.name));
  const disabled = new Set<JobName>();
  for (const entry of (raw ?? "").split(",")) {
    const name = entry.trim();
    if (name === "") continue;
    if (known.has(name)) {
      disabled.add(name as JobName);
    } else {
      console.warn(`[worker] DISABLED_JOBS に知らないジョブ名があります: ${name}`);
    }
  }
  return disabled;
}

/** 実際に登録するジョブ。止める指定のものを除く。 */
export function activeSchedule(disabled: Set<JobName>): ScheduledJob[] {
  return SCHEDULE.filter((job) => !disabled.has(job.name));
}
