// 運営（本部）用の管理画面の判定（タスク4-8）。
// 参照：docs/ClaudeCode_実装指示書.md §4「管理画面（契約・請求・収集キュー）／入金チェックができる」
//       docs/実装仕様書_v1.md §6 エラーコードと復旧
//
// 【なぜ必要か】
// 収集が止まったことに気づけないのが最大のリスク（docs/本番環境_推奨構成.md）。
// いまは「どの案件の資料が取れていないか」「どの機関で空振りしているか」を
// 見る場所が無く、ログを追うしかない。
//
// 【取れていないことを隠さない】
// CLAUDE.md 最重要の前提7。資料が無い理由は「機関が出していない（正常）」と
// 「取得失敗（要対応）」を必ず分ける。並べる順番も、対応が要るものを先にする。
//
// 【対応不要なものを混ぜない】
// 全部を1つの一覧に出すと、本当に直すべきものが埋もれる。
// 復旧の方法（自動で直る／人が直す／直さない）で分ける。

// --- 運営として扱う人 -------------------------------------------------------

/**
 * 運営として扱うメールアドレス。カンマ区切り。
 *
 * 運営かどうかは組織の中の役割（users.role）とは別の軸で、DBに持たせると
 * 顧客側の操作で自分を運営にできてしまう余地が生まれる。
 * デプロイする人だけが変えられる場所（環境変数）に置く。
 */
export function adminEmails(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry !== "");
}

/**
 * 運営か。
 * 設定を忘れたときに全員が入れるより、誰も入れないほうが安全なので、
 * 未設定なら常に false にする。
 */
export function isAdminEmail(email: string | null | undefined, raw: string | undefined): boolean {
  if (!email) return false;
  const allowed = adminEmails(raw);
  if (allowed.length === 0) return false;
  return allowed.includes(email.trim().toLowerCase());
}

/** 失敗コードごとの、扱いと優先順位。数字が小さいほど先に出す。 */
export type FailureAction = {
  /** 画面に出す見出し */
  label: string;
  /** 人が何をすればよいか */
  action: string;
  /** 並び順。1が最優先 */
  priority: number;
  /** 人の対応が要るか。要らないものは件数だけ見せる */
  needsHuman: boolean;
};

export const FAILURE_ACTIONS: Record<string, FailureAction> = {
  // 「即アラート。最優先で修正」（実装仕様書 §6）
  LAYOUT_CHANGED: {
    label: "取得できなくなった（画面構成の変化）",
    action: "コネクタのセレクタを直す。48時間直らないなら、その機関を「取得できていない」と表示する",
    priority: 1,
    needsHuman: true,
  },
  DOC_NOT_FOUND: {
    label: "資料のリンクが切れている",
    action: "3回試して駄目なら、資料を手で登録する",
    priority: 2,
    needsHuman: true,
  },
  OCR_FAILED: {
    label: "文字を読み取れなかった",
    action: "資料を手で登録する",
    priority: 2,
    needsHuman: true,
  },
  PARSE_INVALID: {
    label: "AIの出力が形式に合わなかった",
    action: "再実行する。2回続けて失敗したら、その案件を人が見る",
    priority: 2,
    needsHuman: true,
  },
  AUTH_REQUIRED: {
    label: "ICカードやログインが必要",
    action: "自動化しない。収集端末での正式取得へ回す",
    priority: 3,
    needsHuman: true,
  },
  RATE_LIMITED: {
    label: "相手先の制限に当たった",
    action: "自動で次回に回る。続くようなら間隔を広げる",
    priority: 4,
    needsHuman: false,
  },
  OUT_OF_SCOPE: {
    label: "対象外（工事・自治体など）",
    action: "対応不要。登録だけしている",
    priority: 5,
    needsHuman: false,
  },
};

/** 知らないコードでも黙って捨てない。人が見る対象として扱う。 */
export function failureAction(code: string): FailureAction {
  return (
    FAILURE_ACTIONS[code] ?? {
      label: `未知の失敗（${code}）`,
      action: "コードを確認する。想定していない失敗が起きている",
      priority: 1,
      needsHuman: true,
    }
  );
}

export type CollectionIssue = {
  tenderId: string;
  tenderName: string;
  agencyName: string;
  failureCode: string;
  failureReason: string | null;
  /** 失敗を記録した日時。古いまま放置されていないかを見る */
  at: string | null;
};

export type IssueGroup = FailureAction & {
  code: string;
  issues: CollectionIssue[];
};

/**
 * 失敗コードごとにまとめ、対応が要るものから並べる。
 * 同じ優先度ならコード順にして、実行するたびに並びが変わらないようにする。
 */
export function groupCollectionIssues(issues: CollectionIssue[]): IssueGroup[] {
  const byCode = new Map<string, CollectionIssue[]>();
  for (const issue of issues) {
    const list = byCode.get(issue.failureCode) ?? [];
    list.push(issue);
    byCode.set(issue.failureCode, list);
  }

  return [...byCode.entries()]
    .map(([code, list]) => ({ code, ...failureAction(code), issues: list }))
    .sort((a, b) => a.priority - b.priority || a.code.localeCompare(b.code));
}

/** 「LAYOUT_CHANGED の未対応が48時間続いたら明示する」（実装仕様書 §6）ための時間。 */
export const LAYOUT_CHANGED_ALERT_HOURS = 48;

/** 直っていない期間が長いものを返す。放置に気づけるようにする。 */
export function stalledIssues(groups: IssueGroup[], now: Date, hours: number = LAYOUT_CHANGED_ALERT_HOURS): CollectionIssue[] {
  const limit = now.getTime() - hours * 60 * 60 * 1000;
  const stalled: CollectionIssue[] = [];
  for (const group of groups) {
    if (!group.needsHuman) continue;
    for (const issue of group.issues) {
      if (issue.at === null) continue;
      const at = Date.parse(issue.at);
      if (Number.isNaN(at)) continue;
      if (at <= limit) stalled.push(issue);
    }
  }
  return stalled.sort((a, b) => (a.at ?? "").localeCompare(b.at ?? ""));
}

// --- 契約・請求 -------------------------------------------------------------

export type BillingRow = {
  orgId: string;
  orgName: string;
  status: string;
  paymentMethod: string | null;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
};

export type BillingAttention = BillingRow & { reason: string };

/** トライアルの終わりが近いとみなす日数。 */
export const TRIAL_ENDING_SOON_DAYS = 7;

/**
 * 運営が見るべき契約を返す。
 *
 * 全社を眺めるのではなく「何かする必要がある会社」だけを出す。
 * 入金チェックはここが入口になる。
 */
export function billingAttention(rows: BillingRow[], now: Date): BillingAttention[] {
  const attention: BillingAttention[] = [];
  for (const row of rows) {
    if (row.status === "支払い遅延") {
      const method = row.paymentMethod === "銀行振込" ? "銀行振込の入金を確認する" : "カードの決済に失敗している";
      attention.push({ ...row, reason: `お支払いが確認できていない（${method}）` });
      continue;
    }
    if (row.cancelAtPeriodEnd && row.status !== "解約済") {
      attention.push({ ...row, reason: "解約が予約されている" });
      continue;
    }
    if (row.status === "トライアル中" && daysUntil(row.trialEndsAt, now) !== null) {
      const days = daysUntil(row.trialEndsAt, now)!;
      if (days >= 0 && days <= TRIAL_ENDING_SOON_DAYS) {
        attention.push({ ...row, reason: `お試し期間があと${days}日で終わる` });
      }
    }
  }
  return attention;
}

// --- Stripe（いまは動いていない） -------------------------------------------
//
// 支払いは請求書払いのみになった（ユーザー決定 2026-08-25）。実際に使えるかを
// 決めているのは org_access だけで、subscriptions は何も止めていない。
// 運営画面もこの下の関数ではなく accessSummary / suspendedOrgs を見ている。
//
// 消さずに残しているのは、カード払いを足すときに使うため。
// 使い始めるときは、org_access と連動させるかどうかをそのとき決めること。
// 「支払い遅延なら止める」を無条件に入れると、締切直前に締め出す事故になる。

/** 状態ごとの件数。運営が全体を一目で見るため。 */
export function billingSummary(rows: BillingRow[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.status] = (counts[row.status] ?? 0) + 1;
  return counts;
}

/** 残り日数（JSTの日付で数える）。読めなければ null。 */
export function daysUntil(at: string | null, now: Date): number | null {
  if (at === null) return null;
  const target = Date.parse(at);
  if (Number.isNaN(target)) return null;
  const jstDay = (ms: number) => Math.floor((ms + 9 * 60 * 60 * 1000) / 86_400_000);
  return jstDay(target) - jstDay(now.getTime());
}
