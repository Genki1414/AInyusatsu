export default function SignupCompletePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-6 text-center">
      <h1 className="text-xl font-semibold text-slate-800">確認メールを送信しました</h1>
      <p className="text-sm text-slate-600">
        登録いただいたメールアドレスに確認メールを送信しました。メール内のリンクを開いて登録を完了してください。
      </p>
    </main>
  );
}
