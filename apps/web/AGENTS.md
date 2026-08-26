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
