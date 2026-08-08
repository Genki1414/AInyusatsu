"use client";

// 送信前にブラウザの確認ダイアログを挟む送信ボタン。実際に外部（協力会社）へメールが
// 飛ぶ操作など、誤送信の影響が大きい場面でのみ使う。
import type { ReactNode } from "react";

export function ConfirmSubmitButton({
  confirmMessage,
  className,
  disabled,
  children,
}: {
  confirmMessage: string;
  className?: string;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="submit"
      disabled={disabled}
      className={className}
      onClick={(e) => {
        if (!window.confirm(confirmMessage)) {
          e.preventDefault();
        }
      }}
    >
      {children}
    </button>
  );
}
