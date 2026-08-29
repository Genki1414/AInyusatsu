// プライバシーポリシー。
//
// 【なぜ要るか】
// 個人情報保護法は、個人情報の利用目的を「公表」することを求めている。
// 本サービスは、お客様の担当者と協力会社の担当者の氏名・メールアドレス・電話番号を扱う。
//
// 【協力会社の情報を書き落とさないこと】
// 見落とされやすいが、いちばん説明が要るのはここ。
// 協力会社の担当者は当社ともお客様とも契約していないのに、
// 本サービスを通じてメールを受け取る。誰がどう扱っているかを書く。
//
// 【委託先は実際に使っているものだけを書く】
// packages/*/adapters にあるものが、実際に外部へデータを出している経路のすべて。
// 使っていないものを並べても、使い始めたときに直し忘れる。
//
// 【要記入】が残っている項目は、公開前に必ず埋めること。

import type { Metadata } from "next";

export const metadata: Metadata = { title: "プライバシーポリシー｜AI入札部" };

function Fill({ children }: { children: string }) {
  return <mark className="bg-amber-200 px-1 font-semibold text-amber-900">【要記入：{children}】</mark>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-5">
      <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
      <div className="mt-1.5 space-y-1.5 text-xs leading-relaxed text-slate-700">{children}</div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <>
      <h1 className="text-base font-semibold text-slate-900">プライバシーポリシー</h1>
      <p className="mt-2 text-xs leading-relaxed text-slate-600">
        東北三上機材株式会社（以下「当社」）は、「AI入札部」（以下「本サービス」）の提供にあたり取得する
        個人情報を、個人情報の保護に関する法律その他の法令および本ポリシーに従って取り扱います。
      </p>

      <Section title="1. 取得する情報">
        <p className="font-medium text-slate-800">お客様（契約企業）の担当者に関する情報</p>
        <ul className="ml-4 list-disc space-y-1">
          <li>氏名、メールアドレス（ログインIDを兼ねます）、所属する法人の名称</li>
          <li>本サービスの利用履歴、操作の記録</li>
        </ul>

        <p className="mt-2 font-medium text-slate-800">協力会社の担当者に関する情報</p>
        <ul className="ml-4 list-disc space-y-1">
          <li>お客様が本サービスに登録した、会社名、担当者名、メールアドレス、電話番号、所在地</li>
          <li>見積の回答画面から協力会社が入力した内容</li>
        </ul>
        <p>
          協力会社の情報は、<strong>お客様が登録し、お客様の指示により利用されます。</strong>
          当社は、お客様に代わってこれを保管します。
        </p>

        <p className="mt-2 font-medium text-slate-800">案件の資料に含まれる情報</p>
        <ul className="ml-4 list-disc space-y-1">
          <li>
            発注機関が公開する公告・入札説明書・仕様書等に、担当者名や連絡先が含まれる場合があります。
            これらは公開された情報として取得します。
          </li>
        </ul>
      </Section>

      <Section title="2. 利用目的">
        <ul className="ml-4 list-disc space-y-1">
          <li>本サービスの提供、本人確認、アカウントの管理</li>
          <li>お客様の条件に合う案件の提案、期限や見積の状況の通知</li>
          <li>お客様の指示に基づく、協力会社への見積依頼および連絡</li>
          <li>料金の請求および入金の確認</li>
          <li>お問い合わせへの対応</li>
          <li>本サービスの品質の維持および改善（解析の精度の検証を含みます）</li>
        </ul>
        <p>
          <strong>当社は、取得した個人情報を、当社が販売する他の商品・サービスの勧誘には利用しません。</strong>
        </p>
      </Section>

      <Section title="3. AIによる解析について">
        <p>
          本サービスは、案件の資料を解析するために Anthropic, PBC が提供する生成AIサービスを利用します。
          資料に個人情報が含まれる場合、当該情報が同社のサービスに送信されることがあります。
        </p>
        <p>
          送信するのは<strong>案件の資料と、その解析に必要な情報に限られます。</strong>
          お客様の担当者や協力会社の担当者の情報を、解析のために送信することはありません。
        </p>
      </Section>

      <Section title="4. 第三者への提供">
        <p>
          当社は、次の場合を除き、あらかじめご本人の同意を得ることなく個人情報を第三者に提供しません。
        </p>
        <ul className="ml-4 list-disc space-y-1">
          <li>法令に基づく場合</li>
          <li>人の生命、身体または財産の保護のために必要がある場合であって、本人の同意を得ることが困難であるとき</li>
          <li>国の機関等の法令の定める事務の遂行に協力する必要がある場合</li>
        </ul>
        <p>
          なお、<strong>お客様の指示に基づいて協力会社へ見積依頼や打診を送信することは、</strong>
          お客様の連絡手段として行うものであり、当社による第三者提供ではありません。
        </p>
      </Section>

      <Section title="5. 業務の委託">
        <p>
          当社は、利用目的の達成に必要な範囲で、個人情報の取扱いを次の事業者に委託します。
          委託先には、必要かつ適切な監督を行います。
        </p>
        <div className="overflow-x-auto">
          <table className="mt-1 w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-500">
                <th className="py-1 pr-3 font-medium">委託先</th>
                <th className="py-1 pr-3 font-medium">目的</th>
                <th className="py-1 font-medium">所在国</th>
              </tr>
            </thead>
            <tbody className="text-slate-700">
              <tr className="border-b border-slate-100">
                <td className="py-1 pr-3">Supabase, Inc.</td>
                <td className="py-1 pr-3">データベースおよび認証基盤</td>
                <td className="py-1">日本（東京リージョン）</td>
              </tr>
              <tr className="border-b border-slate-100">
                <td className="py-1 pr-3">Vercel, Inc.</td>
                <td className="py-1 pr-3">アプリケーションの実行環境</td>
                <td className="py-1">日本（東京リージョン）</td>
              </tr>
              <tr className="border-b border-slate-100">
                <td className="py-1 pr-3">Anthropic, PBC</td>
                <td className="py-1 pr-3">資料の解析</td>
                <td className="py-1">米国</td>
              </tr>
              <tr className="border-b border-slate-100">
                <td className="py-1 pr-3">Resend, Inc.</td>
                <td className="py-1 pr-3">メールの送信および受信</td>
                <td className="py-1">米国</td>
              </tr>
              <tr>
                <td className="py-1 pr-3">Railway Corp.</td>
                <td className="py-1 pr-3">収集・解析処理の実行環境</td>
                <td className="py-1">米国</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-1">
          外国にある事業者へ個人情報を提供する場合があります。各国の個人情報保護制度に関する情報は、
          お問い合わせいただければご案内します。
        </p>
      </Section>

      <Section title="6. 安全管理のために講じている措置">
        <ul className="ml-4 list-disc space-y-1">
          <li>データベースの行単位のアクセス制御により、他の契約企業のデータを参照できない構成としています</li>
          <li>通信はすべて暗号化しています</li>
          <li>データベースへの管理者権限での接続は、サーバー側の処理に限定しています</li>
          <li>アカウントの発行および停止は当社が行い、お客様自身による新規登録の機能はありません</li>
        </ul>
      </Section>

      <Section title="7. 保存期間">
        <ul className="ml-4 list-disc space-y-1">
          <li>当社が取得した資料の原本：解析の完了から1年を経過した後に削除します</li>
          <li>解析の結果および抽出したテキスト：本サービスの提供に必要な期間、保持します</li>
          <li>
            お客様が登録したデータ：利用契約の終了後90日を経過した後に削除します
          </li>
        </ul>
      </Section>

      <Section title="8. 開示・訂正・利用停止のご請求">
        <p>
          ご本人からの、保有個人データの開示、内容の訂正、追加または削除、利用の停止、消去および
          第三者への提供の停止のご請求に対応します。下記の窓口までご連絡ください。
        </p>
        <p>
          協力会社の担当者の方からのご請求については、当該情報を登録したお客様に確認のうえ対応します。
          ご請求の内容によっては、お客様へ直接お問い合わせいただくようご案内する場合があります。
        </p>
      </Section>

      <Section title="9. 本ポリシーの変更">
        <p>
          当社は、本ポリシーを変更することがあります。変更後の内容は、本サービス上に掲示した時点から適用します。
        </p>
      </Section>

      <section className="mt-6 border-t border-slate-200 pt-3 text-xs text-slate-600">
        <p>制定日：2026年8月29日</p>
        <p className="mt-1">東北三上機材株式会社</p>
        <p>所在地：宮城県名取市小塚原字東遠泉63番地</p>
        <p>法人番号：4370001041531</p>
        <p>個人情報に関するお問い合わせ窓口：<Fill>担当部署名と問い合わせ先メールアドレス</Fill></p>
      </section>
    </>
  );
}
