# 常駐ワーカー（Railway）用。
#
# 【なぜDockerfileを置くか】
# Railwayの自動判定はこのpnpmモノレポを読めず、ビルドの手前で止まる
# （2026-08-31 実機で確認：railpack が prepare で失敗）。
# 判定に頼らず、動かし方をここに固定する。
#
# 【なぜPlaywrightの公式イメージか】
# 調達ポータルの巡回にChromiumが要る。公式イメージにはブラウザ本体と
# 依存ライブラリが入っているので、`playwright install --with-deps` が要らない。
# 自前で入れると、Chromiumが必要とするシステムライブラリの不足で
# 実行時に落ちる（ビルドは通ってしまうので気づきにくい）。
#
# 【バージョンを固定する】
# イメージのタグは pnpm-lock.yaml の playwright と必ず揃える。
# ずれると「ブラウザが見つからない」で巡回だけが落ちる。
FROM mcr.microsoft.com/playwright:v1.62.1-noble

WORKDIR /app

# ビルドの中で対話的な出力を出さない
ENV CI=true

# ブラウザはイメージに入っているものを使う。
# pnpm 10 は postinstall を既定で走らせないため、playwright が自分で
# ブラウザを取りに行くことはないが、取りに行こうとした場合に備えて明示する。
# ここを取り違えると、ビルドは通って巡回だけが実行時に落ちる
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# pnpm はルートの package.json の packageManager と同じものを使う
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

COPY . .

# ワーカーとその依存パッケージだけ入れる（apps/web の依存は要らない）。
# tsx で直接動かすのでビルド（tsc）は不要。devDependencies も入れる
RUN pnpm install --frozen-lockfile --filter worker...

# HTTPは受けない常駐プロセス。ポートは開かない
CMD ["pnpm", "--filter", "worker", "start"]
