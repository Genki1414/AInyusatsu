// 協力会社の回答（タスク4-2）の純ロジック。
// 資料送付メール・回答通知メールの組み立て、資料の並び順・ファイル名、
// 署名付きURLの有効期限の算出。副作用は持たせない（送信・Storage操作は呼び出し側）。

/** 資料の種別。docs/資料取得方針_v3.md の5種類＋その他。メールに並べる順序でもある。 */
export const DOCUMENT_KIND_ORDER = ["公告", "入札説明書", "仕様書", "数量表", "様式", "その他"] as const;

export type QuoteResponseChoice = "request_documents" | "decline";

export function choiceLabel(choice: QuoteResponseChoice): string {
  return choice === "request_documents" ? "資料請求" : "今回は見送る";
}

/**
 * 署名付きURLの有効期限（秒）。回答期限まで確実に使えるよう、回答期限＋7日を確保する。
 * 回答期限が未設定・過去の場合や、極端に先の場合は下限7日・上限90日に収める。
 */
export function signedUrlTtlSeconds(dueAt: Date | null, now: Date): number {
  const day = 60 * 60 * 24;
  const min = 7 * day;
  const max = 90 * day;
  if (!dueAt || Number.isNaN(dueAt.getTime())) return min;
  const untilDue = Math.floor((dueAt.getTime() - now.getTime()) / 1000);
  return Math.min(max, Math.max(min, untilDue + min));
}

export type DocumentRef = { kind: string; storage_key: string; filename?: string | null };

/** 資料を種別の既定順（公告→入札説明書→…）に並べる。一覧に無い種別は末尾に回す。 */
export function sortDocumentsByKind<T extends DocumentRef>(documents: T[]): T[] {
  const order = (kind: string) => {
    const i = (DOCUMENT_KIND_ORDER as readonly string[]).indexOf(kind);
    return i === -1 ? DOCUMENT_KIND_ORDER.length : i;
  };
  return [...documents].sort((a, b) => order(a.kind) - order(b.kind) || a.storage_key.localeCompare(b.storage_key));
}

/**
 * ダウンロード時の表示名を決める（Storage上のハッシュ名では中身が分からないため）。
 * 収集時に保存した元のファイル名（例：06_数量総括表.pdf）があればそれを使う。
 * 無い場合（収集がファイル名の保存に対応する前のデータ）は種別で代替し、
 * 同じ種別が複数あれば連番を付ける。
 */
export function documentFilenames(documents: DocumentRef[]): { kind: string; storage_key: string; label: string }[] {
  const seen = new Map<string, number>();
  return documents.map((doc) => {
    const original = doc.filename?.trim();
    if (original) return { kind: doc.kind, storage_key: doc.storage_key, label: original };

    const dot = doc.storage_key.lastIndexOf(".");
    const slash = doc.storage_key.lastIndexOf("/");
    const ext = dot > slash && dot !== -1 ? doc.storage_key.slice(dot) : "";
    const n = seen.get(doc.kind) ?? 0;
    seen.set(doc.kind, n + 1);
    return { kind: doc.kind, storage_key: doc.storage_key, label: n === 0 ? `${doc.kind}${ext}` : `${doc.kind}_${n + 1}${ext}` };
  });
}

export type DocumentsEmailInput = {
  partnerName: string;
  senderOrgName: string;
  senderContactEmail: string | null; // 協力会社が返信できる連絡先。無ければ署名から省く
  tenderName: string;
  trade: string;
  dueAtLabel: string | null; // 表示用に整形済み（timezone変換は呼び出し側の責務）
  expiresAtLabel: string; // 署名付きURLの失効日時（同上）
  links: { kind: string; label: string; url: string }[];
};

/** 資料請求への自動送付メール。 */
export function buildDocumentsEmail(input: DocumentsEmailInput): { subject: string; body: string } {
  const lines: string[] = [
    `${input.partnerName} 様`,
    "",
    "お世話になっております。",
    `${input.senderOrgName}でございます。`,
    "",
    `ご請求いただきました「${input.tenderName}」（${input.trade}）の資料をお送りいたします。`,
    `下記のリンクからダウンロードしてください（${input.expiresAtLabel} まで有効です）。`,
    "",
    ...input.links.flatMap((l) => [`【${l.kind}】${l.label}`, l.url]),
    "",
  ];
  if (input.dueAtLabel) lines.push(`お見積りの回答期限：${input.dueAtLabel}`, "");
  lines.push("ご検討のほど、よろしくお願いいたします。", "", "--", input.senderOrgName);
  if (input.senderContactEmail) lines.push(input.senderContactEmail);
  return { subject: `【資料送付】${input.tenderName}`, body: lines.join("\n") };
}

export type ResponseNotificationInput = {
  partnerName: string;
  tenderName: string;
  trade: string;
  choice: QuoteResponseChoice;
  memo: string | null;
  /** 回答期限を過ぎてからの回答か（担当者が気づけるように明記する） */
  afterDue: boolean;
  /** 自動送付の失敗など、担当者の対応が必要な事情。無ければnull */
  warning: string | null;
  tenderUrl: string | null;
};

/** 依頼元の担当者へ送る、協力会社の回答通知メール。 */
export function buildResponseNotificationEmail(input: ResponseNotificationInput): { subject: string; body: string } {
  const label = choiceLabel(input.choice);
  const lines: string[] = [
    `${input.partnerName} から見積依頼への回答がありました。`,
    "",
    `案件：${input.tenderName}`,
    `業種：${input.trade}`,
    `回答：${label}`,
  ];
  if (input.memo) lines.push(`備考：${input.memo}`);
  if (input.afterDue) lines.push("※回答期限を過ぎてからの回答です");
  if (input.warning) lines.push(`※${input.warning}`);
  lines.push("", "詳しくは案件詳細の「見積状況」タブをご確認ください。");
  if (input.tenderUrl) lines.push(input.tenderUrl);
  return { subject: `【見積依頼への回答】${label}／${input.tenderName}`, body: lines.join("\n") };
}
