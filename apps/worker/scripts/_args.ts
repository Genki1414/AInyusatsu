// CLIランナー共通の引数取得ヘルパー。
// `pnpm --filter worker <script> -- 引数` のように"--"経由で渡すと、pnpmは"--"を
// 取り除かずにそのまま子プロセスへ渡す（npmと異なる挙動）。先頭の"--"を取り除いてから使う。
export function cliArgs(): string[] {
  const raw = process.argv.slice(2);
  return raw[0] === "--" ? raw.slice(1) : raw;
}
