# AI入札部

全省庁統一資格で参加できる入札案件を収集・解析し、企業ごとに提案して、
協力会社への見積依頼から提出書類の準備までを支援するサービス。

詳細仕様は `docs/実装仕様書_v1.md` と `CLAUDE.md` を参照してください。

## 構成

```
apps/web/       Next.js（App Router）
apps/worker/    常駐ワーカー（Railway・pg-boss）
packages/domain/ 純ロジック（適合判定・原価集計・重複排除 等）
packages/db/     Supabase生成型・サーバー専用クエリ
packages/ai/     Claude APIアダプタ・プロンプト
supabase/        migrations・seed
docs/            設計ドキュメント一式
```

## セットアップ

```bash
pnpm install
pnpm dev            # apps/web を起動
supabase start      # ローカルSupabase（Docker必須）
supabase db reset   # migrations を適用
```
