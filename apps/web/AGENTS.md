<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## 実際に踏んだ落とし穴

### `"use server"` のファイルからは async 関数しか export できない

型以外の値（初期stateのオブジェクトなど）を export すると、
**ビルドは通り、デプロイも成功し、そのアクションをPOSTした瞬間に500になる。**
`tsc` も `eslint` も `next build` も検出しない。

```
Error: A "use server" file can only export async functions, found object.
```

`useActionState` の初期値は、呼び出す側（クライアントコンポーネント）に置くこと。

サーバーアクションを追加したら、**必ず一度は実際に押して確かめる**。

### formの hidden を落としても、何も教えてくれない

サーバーアクションが `formData.get("tender_id")` で受け取っていると、
画面を組み直したときに `<input type="hidden" name="tender_id">` を落としても、
**`tsc` も `eslint` も `next build` も通る。**

実際に踏んだ（2026-08-31）。段取りのチェックを押すと印が付き、すぐ消えて戻る状態になった。
アクションは「案件が指定されていません」を返していたが、
画面側は先に印を付けていた（`useOptimistic`）ので、押せているように見えていた。

**値は引数で受け取る。** 渡し忘れが型で止まる。

```ts
// 落としても気づけない
export async function toggle(formData: FormData) {
  const tenderId = String(formData.get("tender_id") ?? "");
}

// 渡し忘れると tsc が止める
export async function toggle(tenderId: string, step: string, checked: boolean) {}
```

formを使う場合は、**アクションが読むキーと、formにあるフィールドを1つずつ突き合わせる。**
アクションのPOSTを1回叩くだけでは足りない。空のpayloadでも
`requireOrgContext()` までは進むので、「動いた」ように見えてしまう。
