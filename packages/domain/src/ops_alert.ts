// 本部への異常通知の組み立て（純ロジック）。
//
// 【なぜ要るか】
// docs/本番環境_推奨構成.md にこう書いてある。
//   「コネクタのセレクタが空振り（LAYOUT_CHANGED）→ 即通知。
//     これを放置するとサービスが静かに死にます」
// いま失敗はログに出るだけで、誰にも届いていない。/admin を開けば見えるが、
// 毎朝開く前提は現実的ではない。顧客に「案件が来ない」と言われて初めて気づく。
//
// 【問題が無くても送る】
// 「異常があるときだけ送る」にすると、ワーカーごと止まったときに何も届かない。
// 静かに死ぬのを防ぐのが目的なのに、いちばん危ない壊れ方を検知できない。
// 毎朝必ず1通送り、件名に状態を入れる。**届かない日があること自体が異常の合図**になる。
//
// 【件名で判断できるようにする】
// 開かないと分からない通知は読まれなくなる。要対応の件数を件名に入れる。

import { failureAction, type IssueGroup } from "./admin_console";

export type OpsAlertInput = {
  /** 資料取得・AI解析の失敗（コード別にまとめたもの） */
  groups: IssueGroup[];
  /** 48時間以上直っていない失敗 */
  stalled: number;
  /** 発注機関のカバレッジ */
  coverage: { checked: number; healthy: number; missing: number; delayed: number };
  /** 直近24時間に失敗したジョブの名前 */
  failedJobs: string[];
  /** 表示に使う日付（Asia/Tokyo の YYYY-MM-DD） */
  dateLabel: string;
};

export type OpsAlert = {
  subject: string;
  body: string;
  /** 対応が必要な件数。0 なら正常 */
  attention: number;
};

/**
 * 対応が必要な数を数える。
 *
 * 「人が動かないと直らないもの」だけを数える。自動で回復するもの（RATE_LIMITED の
 * 待ちなど）まで足すと、数字が大きいまま動かず、見なくなる。
 */
export function countAttention(input: OpsAlertInput): number {
  const needsHuman = input.groups.filter((g) => g.needsHuman).reduce((n, g) => n + g.issues.length, 0);
  return needsHuman + input.coverage.missing + input.failedJobs.length;
}

function line(label: string, value: number): string {
  return `${label}：${value}件`;
}

export function buildOpsAlert(input: OpsAlertInput): OpsAlert {
  const attention = countAttention(input);
  const subject =
    attention === 0
      ? `［AI入札部］正常　${input.dateLabel}`
      : `［AI入札部］要対応 ${attention}件　${input.dateLabel}`;

  const parts: string[] = [];

  if (input.failedJobs.length > 0) {
    // 収集が止まっているのが最悪の状態なので、いちばん上に出す
    parts.push(
      "■ 失敗したジョブ\n" +
        input.failedJobs.map((name) => `・${name}`).join("\n") +
        "\nRailway のログを確認してください。",
    );
  }

  if (input.stalled > 0) {
    parts.push(
      `■ 48時間以上直っていない失敗が${input.stalled}件あります\n` +
        "該当する機関は「取得できていない」状態が続いています。",
    );
  }

  const humanGroups = input.groups.filter((g) => g.needsHuman && g.issues.length > 0);
  if (humanGroups.length > 0) {
    parts.push(
      "■ 対応が必要な失敗\n" +
        humanGroups
          .map((g) => `・${g.code}（${g.label}）${g.issues.length}件\n　　${g.action}`)
          .join("\n"),
    );
  }

  // 自動で回復するものは件数だけ。動かなくてよいものを一覧にすると本題が埋もれる
  const autoGroups = input.groups.filter((g) => !g.needsHuman && g.issues.length > 0);
  if (autoGroups.length > 0) {
    parts.push(
      "■ 様子見（自動で再試行します）\n" +
        autoGroups.map((g) => `・${g.code}（${g.label}）${g.issues.length}件`).join("\n"),
    );
  }

  parts.push(
    "■ 発注機関のカバレッジ\n" +
      `・正常：${input.coverage.healthy} / ${input.coverage.checked}\n` +
      `・${line("欠測・未取得", input.coverage.missing)}\n` +
      `・${line("遅延", input.coverage.delayed)}`,
  );

  if (attention === 0) {
    parts.unshift("対応が必要なものはありません。");
  }

  parts.push(
    "この通知は毎朝1通、異常が無くても送ります。\n" +
      "**届かない日があれば、ワーカーが止まっている可能性があります。**",
  );

  return { subject, body: parts.join("\n\n"), attention };
}

/**
 * 失敗コードから、本部が取る行動を1行で返す。
 * 通知とダッシュボードで説明が食い違わないよう、同じ表を使う。
 */
export function opsActionFor(code: string): string {
  return failureAction(code).action;
}
