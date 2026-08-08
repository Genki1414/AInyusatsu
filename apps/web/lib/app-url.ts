// 協力会社の回答ページ（/q/[token]）など、メール本文に埋め込む絶対URLを組み立てるための
// アプリのベースURL。開発時は `pnpm dev` の既定ポート（3001）にフォールバックする。
export function getAppUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3001").replace(/\/+$/, "");
}
