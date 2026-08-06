// AI解析（プロンプト1：基本情報と期限）の抽出後のルールベース検証（タスク2-3b）。
// 参照：docs/AI解析プロンプト集.md §1「抽出後のルールベース検証（必須）」
//
// 「1〜4のいずれかに違反したら、その案件は自動で『要確認』フラグを立て、提案時に警告を
// 表示します」という方針に基づく。ルール5・6（unknown_fieldsの整合性・budgetの整合性）は
// プロンプト自身の出力形式に関する検証であり、Zodスキーマと出力指示側の責務のためここには
// 含めない。

export type TenderDates = {
  noticeDate: string | null; // YYYY-MM-DD
  submitDeadline: string | null; // YYYY-MM-DDTHH:mm
  qaDeadline: string | null; // YYYY-MM-DDTHH:mm
  bidOpenAt: string | null; // YYYY-MM-DDTHH:mm
};

export type DateValidationIssue = {
  rule: "submit_before_bid_open" | "qa_before_submit" | "notice_before_submit" | "date_within_two_years";
  message: string;
};

const TWO_YEARS_MS = 2 * 365 * 24 * 60 * 60 * 1000;

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * 期限の前後関係・和暦変換ミスの検出を行う。日付が無い（null・パース不能）項目は、
 * 比較対象から外すだけでそれ自体は違反としない（「取れなければnullにする」方針のため）。
 */
export function validateTenderDates(dates: TenderDates): DateValidationIssue[] {
  const issues: DateValidationIssue[] = [];
  const notice = parseDate(dates.noticeDate);
  const submit = parseDate(dates.submitDeadline);
  const qa = parseDate(dates.qaDeadline);
  const bidOpen = parseDate(dates.bidOpenAt);

  // ルール1: submit_deadline < bid_open_at
  if (submit && bidOpen && submit.getTime() >= bidOpen.getTime()) {
    issues.push({
      rule: "submit_before_bid_open",
      message: "提出期限が開札日時と同時刻か、それより後になっています（取り違えの可能性）",
    });
  }

  // ルール2: qa_deadline < submit_deadline
  if (qa && submit && qa.getTime() >= submit.getTime()) {
    issues.push({
      rule: "qa_before_submit",
      message: "質問期限が提出期限と同時刻か、それより後になっています（取り違えの可能性）",
    });
  }

  // ルール3: notice_date <= submit_deadline
  if (notice && submit && notice.getTime() > submit.getTime()) {
    issues.push({ rule: "notice_before_submit", message: "公告日が提出期限より後になっています" });
  }

  // ルール4: すべての日付が公告日から2年以内（和暦変換ミスの検出）
  if (notice) {
    const others: [string, Date | null][] = [
      ["提出期限", submit],
      ["質問期限", qa],
      ["開札日時", bidOpen],
    ];
    for (const [label, date] of others) {
      if (date && Math.abs(date.getTime() - notice.getTime()) > TWO_YEARS_MS) {
        issues.push({
          rule: "date_within_two_years",
          message: `${label}が公告日から2年以上離れています（和暦変換ミスの可能性）`,
        });
      }
    }
  }

  return issues;
}
