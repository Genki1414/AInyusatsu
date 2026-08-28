// 画面の切り替え中に出すもの。
//
// 【なぜ必要か】
// この製品の画面はすべて動的（ログイン状態で内容が変わる）。Next.jsは動的な画面を、
// loading.tsx がある所までしか先読みしない。境界が1つも無いと、クリックしてから
// サーバーの描画が終わるまで画面が固まったままになる（実測で約3秒）。
// 境界を置くと、クリックした瞬間に切り替わり、中身は届き次第入る。
//
// 表示している内容が減るわけではない。待っていることが分かるようになるだけ。
//
// 背景をAppShellと同じ色にしているのは、切り替わるたびに白く光らせないため。
export default function Loading() {
  return (
    <div className="min-h-screen bg-slate-100">
      <div className="h-12 bg-slate-800" />
      <div className="mx-auto max-w-6xl p-3">
        <p className="text-xs text-slate-500">読み込んでいます…</p>
      </div>
    </div>
  );
}
