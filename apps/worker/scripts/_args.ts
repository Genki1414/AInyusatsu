// CLIランナー共通の引数まわり。
//
// `pnpm --filter worker <script> -- 引数` のように"--"経由で渡すと、pnpmは"--"を
// 取り除かずにそのまま子プロセスへ渡す（npmと異なる挙動）。先頭の"--"を取り除いてから使う。
//
// 【なぜ検証するのか】
// Windowsのコマンドプロンプトは "#" 以降をコメントにしない。手順をコピーして
// `pnpm ... kkj:sync  # 説明` のように貼ると、"#" と説明文がそのまま引数になる。
// 検証が無いと「HTTP 500」「Invalid time value」のような、原因の分からない失敗になる。
// 受け取った値をそのまま見せて、何が悪いかが分かるようにする。

import { isDateIso } from "@ai-nyusatsu-bu/domain";

/** 使い方の誤り。スタックトレースを出さずにメッセージだけ見せる。 */
export class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliUsageError";
  }
}

export function cliArgs(): string[] {
  const raw = process.argv.slice(2);
  return raw[0] === "--" ? raw.slice(1) : raw;
}

/** YYYY-MM-DD として読める値を返す。読めなければ使い方の誤りとして止める。 */
export function requireDateIso(raw: string, label: string): string {
  if (!isDateIso(raw)) {
    throw new CliUsageError(`${label}は YYYY-MM-DD で指定してください（受け取った値: ${JSON.stringify(raw)}）`);
  }
  return raw;
}

/** 1以上の整数を返す。読めなければ使い方の誤りとして止める。 */
export function requirePositiveInt(raw: string, label: string): number {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new CliUsageError(`${label}は1以上の整数で指定してください（受け取った値: ${JSON.stringify(raw)}）`);
  }
  return parsed;
}

/**
 * 想定より多い引数が来ていたら止める。
 * Windowsで "#" 以降がコメントにならず引数として渡る事故を、その場で気づけるようにする。
 */
export function rejectExtraArgs(args: string[], max: number, usage: string): void {
  if (args.length > max) {
    throw new CliUsageError(
      `引数が多すぎます（${args.length}個：${args.map((a) => JSON.stringify(a)).join(" ")}）。` +
        `\nWindowsのコマンドプロンプトでは "#" 以降がコメントになりません。説明を付けずに実行してください。` +
        `\n使い方: ${usage}`,
    );
  }
}

/** CLIの入口。使い方の誤りはメッセージだけ、それ以外は原因を追えるようそのまま出す。 */
export function runCli(main: () => Promise<void>): void {
  main().catch((err) => {
    if (err instanceof CliUsageError) {
      console.error(err.message);
    } else {
      console.error(err);
    }
    process.exitCode = 1;
  });
}
