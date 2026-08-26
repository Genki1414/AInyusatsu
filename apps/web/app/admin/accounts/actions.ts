"use server";

// 本部によるアカウントの発行・停止（タスク4-8の続き）。
//
// 【なぜ本部が発行するか】
// 支払いは請求書払いのみ（ユーザー決定 2026-08-25）。カード決済のように自動で
// 契約が始まらないため、誰が使えるかは本部が決める。セルフ登録の画面は廃止した。
//
// 【service_role でしか行えない】
// auth.admin.createUser（管理者としてのユーザー作成）も org_access の書き込みも、
// service_role でなければ通らない。requireAdmin が運営であることを確かめたうえで
// クライアントを受け取る。この関数を通さずに service_role を使わないこと。
//
// 【初期パスワードは一度だけ画面に出す】
// 招待メールにしないのは、メール送信の設定に依存させたくないため（届かないと
// 発行そのものが止まる）。本部が電話やメールで本人に伝える運用にする。
// DBには保存しない。控え忘れたときは「パスワード再発行」で作り直す。

import { randomInt } from "node:crypto";
import { revalidatePath } from "next/cache";
import {
  buildInitialPassword,
  SUSPEND_REASONS,
  INITIAL_PASSWORD_ALPHABET,
  INITIAL_PASSWORD_LENGTH,
  validateIssueAccount,
} from "@ai-nyusatsu-bu/domain";
import { requireAdmin } from "@/lib/admin";

export type AccountActionState = {
  error: string | null;
  /** 完了したことを伝える文言 */
  message: string | null;
  /** 発行・再発行したときだけ入る。画面に一度だけ出す */
  password: string | null;
  /** password をどのアカウントのものか示すため */
  email: string | null;
};

// "use server" のファイルからは async 関数しか export できない（Next.jsの制約）。
// 初期値は呼び出し側（account-forms.tsx）に置いている。
const EMPTY: AccountActionState = { error: null, message: null, password: null, email: null };

function fail(error: string): AccountActionState {
  return { ...EMPTY, error };
}

/** 暗号論的乱数から初期パスワードを作る。組み立て自体は packages/domain（テスト済み）。 */
function newInitialPassword(): string {
  const picks = Array.from({ length: INITIAL_PASSWORD_LENGTH }, () => randomInt(INITIAL_PASSWORD_ALPHABET.length));
  return buildInitialPassword(picks);
}

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

/**
 * 新しい会社のアカウントを発行する。
 *
 * organizations / users / company_profiles の作成はDBトリガー（handle_new_user）が行う。
 * 参照：supabase/migrations/20260803000001_auth_signup_trigger.sql
 */
export async function issueAccount(
  _prevState: AccountActionState,
  formData: FormData,
): Promise<AccountActionState> {
  const { admin } = await requireAdmin();

  const validated = validateIssueAccount({
    orgName: text(formData, "org_name"),
    userName: text(formData, "user_name"),
    email: text(formData, "email"),
  });
  if (!validated.ok) return fail(validated.error);
  const { orgName, userName, email } = validated.value;

  const password = newInitialPassword();
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    // 本部が本人確認をしたうえで発行するので、確認メールは挟まない
    email_confirm: true,
    user_metadata: { org_name: orgName, name: userName },
  });
  if (createError || !created?.user) {
    // よくある失敗（アドレスの重複）は言い換えて出す。それ以外は原因をそのまま見せる
    const detail = createError?.message ?? "原因が返りませんでした";
    const duplicated = /already|registered|exists/i.test(detail);
    return fail(
      duplicated
        ? `${email} はすでに登録されています。一覧から状態を確認してください`
        : `アカウントを作成できませんでした：${detail}`,
    );
  }

  // トリガーが作った users 行から org_id を引く（作成と同じトランザクションで入るので、ここでは必ずある）
  const { data: profile, error: profileError } = await admin
    .from("users")
    .select("org_id")
    .eq("id", created.user.id)
    .maybeSingle<{ org_id: string }>();
  if (profileError || !profile) {
    // ログインはできるが組織が引けない状態。放置すると原因が分からなくなるので必ず出す
    return fail(
      `${email} のログインは作成されましたが、組織を作成できませんでした（${profileError?.message ?? "users 行がありません"}）。` +
        "Supabaseの認証ユーザーを削除してから、やり直してください",
    );
  }

  const { error: accessError } = await admin
    .from("org_access")
    .upsert({ org_id: profile.org_id, status: "利用中", activated_at: new Date().toISOString(), updated_at: new Date().toISOString() });
  if (accessError) {
    // 既定は「停止」なので、ここで失敗したままだとログインしても使えない。握りつぶさない
    return fail(
      `${email} のアカウントは作成しましたが、利用開始にできませんでした（${accessError.message}）。` +
        "一覧の「再開」を押して、状態を「利用中」にしてください",
    );
  }

  revalidatePath("/admin/accounts");
  return {
    error: null,
    message: `${orgName}（${email}）のアカウントを発行しました。初期パスワードは一度しか表示されません`,
    password,
    email,
  };
}

/** 停止・再開・パスワード再発行。どれも一覧の行から行う。 */
export async function updateAccount(
  _prevState: AccountActionState,
  formData: FormData,
): Promise<AccountActionState> {
  const { admin } = await requireAdmin();

  const orgId = text(formData, "org_id");
  const op = text(formData, "op");
  if (orgId === "") return fail("組織が指定されていません");

  const now = new Date().toISOString();

  if (op === "停止") {
    // 定型（reason）か、「その他」を選んだときの自由入力（reason_other）。
    // 定型を選んでいれば reason_other は送られてこない
    const other = text(formData, "reason_other").trim();
    const reason = other !== "" ? other : text(formData, "reason").trim();
    // 定型に無い値をそのまま通さない。UIが壊れて "__other__" が入ると顧客に見えてしまう
    const known = (SUSPEND_REASONS as readonly string[]).includes(reason);
    if (reason === "" || (!known && other === "")) {
      return fail("停止の理由を選ぶか、入力してください（本人の画面に表示されます）");
    }
    const { error } = await admin
      .from("org_access")
      .upsert({ org_id: orgId, status: "停止", suspended_at: now, suspended_reason: reason, updated_at: now });
    if (error) return fail(`停止できませんでした：${error.message}`);
    revalidatePath("/admin/accounts");
    return { ...EMPTY, message: "停止しました。次に画面を開いたときから使えなくなります" };
  }

  if (op === "再開") {
    const { error } = await admin
      .from("org_access")
      .upsert({ org_id: orgId, status: "利用中", activated_at: now, suspended_at: null, suspended_reason: null, updated_at: now });
    if (error) return fail(`再開できませんでした：${error.message}`);
    revalidatePath("/admin/accounts");
    return { ...EMPTY, message: "再開しました" };
  }

  if (op === "パスワード再発行") {
    const userId = text(formData, "user_id");
    const email = text(formData, "email");
    if (userId === "") return fail("対象のログインが見つかりません");
    const password = newInitialPassword();
    const { error } = await admin.auth.admin.updateUserById(userId, { password });
    if (error) return fail(`パスワードを変更できませんでした：${error.message}`);
    return {
      error: null,
      message: "パスワードを再発行しました。いまのパスワードは使えなくなります",
      password,
      email: email === "" ? null : email,
    };
  }

  return fail(`知らない操作です：${op}`);
}
