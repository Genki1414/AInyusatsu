// 協力会社へ送るメールの差出人・返信先を、企業ごとに解決する。
//
// 協力会社にとっての取引相手は、サービスの運営会社ではなく依頼元の顧客企業。
// 差出人の表示名は顧客企業の名前にし、返信先も顧客企業へ向ける。
// 判定そのものは packages/domain の resolveSenderIdentity に置き、ここではDBから
// 設定を引くだけにする。
//
// 実アドレスがサービスのドメインなのは、顧客企業のドメインから実送信するには
// そのドメインをResendで認証する必要があり、導入時にそれを求めると顧客が離脱するため
// （ユーザー判断 2026-08-22）。

import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveSenderIdentity, type SenderIdentity } from "@ai-nyusatsu-bu/domain";
import { serviceFromAddress } from "@ai-nyusatsu-bu/notifications";

/**
 * 差出人と返信先を決める。
 * 返信先の設定を読めなかった場合も送信は止めない（登録者のアドレスに落とす）。
 * ここで失敗して見積依頼そのものが送れなくなるほうが困るため。
 */
export async function loadSenderIdentity(
  supabase: SupabaseClient,
  orgId: string,
  orgName: string,
  ownerEmail: string | null,
): Promise<SenderIdentity> {
  const { data, error } = await supabase
    .from("organizations")
    .select("reply_to")
    .eq("id", orgId)
    .maybeSingle<{ reply_to: string | null }>();
  if (error) {
    console.error(`[sender] 返信先の取得に失敗しました（org=${orgId}）: ${error.message}`);
  }

  return resolveSenderIdentity({
    orgName,
    serviceAddress: serviceFromAddress(),
    configuredReplyTo: data?.reply_to ?? null,
    ownerEmail,
  });
}
