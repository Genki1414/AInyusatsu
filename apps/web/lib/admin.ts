// 運営（本部）用の画面へ入れるかの判定（タスク4-8）。
//
// 【なぜ環境変数で持つか】
// 運営かどうかは組織の中の役割（users.role）とは別の軸で、DBに持たせると
// 顧客側の操作で自分を運営にできてしまう余地が生まれる。
// デプロイする人だけが変えられる場所（環境変数）に置く。
//
// 【未設定なら誰も入れない】
// 設定を忘れたときに全員が入れるより、誰も入れないほうが安全。
//
// 【存在を隠す】
// 権限が無いときは403ではなく404を返す。運営画面のURLがあること自体を知らせない。
//
// 【service_role を使う】
// 運営画面は組織をまたいで見る必要があり、RLSでは引けない。
// ここで運営であることを確かめたうえで、service_role のクライアントを渡す。
// この関数を通さずに service_role を使わないこと。

import { notFound } from "next/navigation";
import { createServiceClient } from "@ai-nyusatsu-bu/db";
import { adminEmails, isAdminEmail } from "@ai-nyusatsu-bu/domain";
import { createClient } from "@/lib/supabase/server";

export type AdminContext = {
  email: string;
  /** 組織をまたいで読むためのクライアント。運営画面でのみ使う */
  admin: ReturnType<typeof createServiceClient>;
};

/** 運営でなければ404にする。ログインしていない場合も同じ。 */
export async function requireAdmin(): Promise<AdminContext> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!isAdminEmail(user?.email, process.env.ADMIN_EMAILS)) {
    // 画面には何も出さないが、設定の誤りに気づけるようログには残す。
    // 404しか返らないと、設定漏れなのかURL違いなのか運営自身も分からなくなる。
    // アドレスの一覧そのものは出さない（件数だけ）。
    const configured = adminEmails(process.env.ADMIN_EMAILS).length;
    console.warn(
      `[admin] 権限がありません（ログイン中: ${user?.email ?? "未ログイン"} / ADMIN_EMAILS の登録数: ${configured}）` +
        (configured === 0 ? " ※ADMIN_EMAILS が未設定です。設定して再デプロイしてください" : ""),
    );
    // 権限が無いことも、画面があることも知らせない
    notFound();
  }

  return { email: user!.email!, admin: createServiceClient() };
}
