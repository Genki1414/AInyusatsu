"use client";

// 回答ページの開封記録（開封確認）。
// Server Componentのレンダリング中にDBを更新すると、リンクのプリフェッチやリロードでも
// 記録されてしまい「実際に開いたか」が曖昧になるため、ブラウザで実際に描画されてから
// 1回だけサーバーへ知らせる。記録は初回の開封のみ（actions.ts側でガードしている）。
import { useEffect, useRef } from "react";
import { recordQuoteOpened } from "./actions";

export function RecordOpened({ token }: { token: string }) {
  const sent = useRef(false);

  useEffect(() => {
    // React 18以降の開発時の二重実行でも1回しか送らない
    if (sent.current) return;
    sent.current = true;
    // 開封記録の失敗は協力会社の操作を妨げないため、画面には出さない（サーバー側でログに残す）。
    void recordQuoteOpened(token);
  }, [token]);

  return null;
}
