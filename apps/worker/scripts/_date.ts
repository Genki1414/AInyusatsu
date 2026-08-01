// CLIランナー共通の日付ヘルパー。副作用は無いが、実行時刻に依存するためテスト対象外。

/** JST基準の「前日」を YYYY-MM-DD で返す。CLIランナーの引数省略時の既定値に使う。 */
export function yesterdayJst(): string {
  const nowJst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  nowJst.setUTCDate(nowJst.getUTCDate() - 1);
  return nowJst.toISOString().slice(0, 10);
}
