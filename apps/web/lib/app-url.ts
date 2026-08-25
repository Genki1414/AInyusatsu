// 協力会社の回答ページ（/q/[token]）など、メール本文に埋め込む絶対URLを組み立てるための
// アプリのベースURL。開発時は `pnpm dev` の既定ポート（3001）にフォールバックする。
//
// 【NEXT_PUBLIC_ を外した理由】
// この値を読むのはサーバーアクション（見積依頼の送信）と常駐ワーカー（催促メール）だけで、
// ブラウザからは一度も読んでいない。NEXT_PUBLIC_ を付けると、必要のない値をブラウザへ
// 配ることになる。加えてVercelは NEXT_PUBLIC_ の付いた変数をSecretとして保存できないため、
// 設定を変えようとすると詰まる（2026-08-25 実機で確認）。
//
// 以前の設定を消さずに移行できるよう、NEXT_PUBLIC_APP_URL も引き続き見る。
export function getAppUrl(): string {
  const configured = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3001";
  return configured.replace(/\/+$/, "");
}
