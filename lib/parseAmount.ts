// レシートのOCRテキストから「合計金額」を推測する純粋関数。
// OCRは精度100%ではない前提なので、推測に失敗したら null を返し、
// ユーザーが手入力で直せるようにする（UI側で編集可能な初期値として使う）。

// 「合計」を表す表記ゆれ。店によって様々なのでまとめて対応する。
const TOTAL_KEYWORDS = [
  "合計",
  "合 計",
  "ご合計",
  "お会計",
  "お支払",
  "支払合計",
  "税込合計",
  "総合計",
  "総計",
  "現計",
];

// 「合計」と紛らわしいが合計ではない行（除外する）。
const EXCLUDE_KEYWORDS = ["小計", "中計", "課税対象", "お預", "釣", "つり"];

function normalize(text: string): string {
  return (
    text
      // 全角数字 → 半角
      .replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0))
      // 全角カンマ → 半角
      .replace(/，/g, ",")
  );
}

// 1行から「金額っぽい数値」を取り出す（カンマ区切り対応）。
function numbersInLine(line: string): number[] {
  const matches = line.match(/\d[\d,]*/g) ?? [];
  return matches
    .map((m) => parseInt(m.replace(/,/g, ""), 10))
    .filter((n) => Number.isFinite(n) && n >= 10 && n <= 9_999_999);
}

export function parseTotalAmount(ocrText: string): number | null {
  if (!ocrText) return null;
  const lines = normalize(ocrText).split(/\r?\n/);

  // 1) 「合計」系キーワードを含む行から、その行の最大値を候補にする。
  const candidates: number[] = [];
  for (const line of lines) {
    if (EXCLUDE_KEYWORDS.some((w) => line.includes(w))) continue;
    if (TOTAL_KEYWORDS.some((w) => line.includes(w))) {
      const nums = numbersInLine(line);
      if (nums.length) candidates.push(Math.max(...nums));
    }
  }
  // 合計は通常いちばん大きい金額になる。
  if (candidates.length) return Math.max(...candidates);

  // 2) フォールバック: 「円」付き or カンマ区切りの数値の最大値。
  const fallback: number[] = [];
  for (const line of lines) {
    const m =
      line.match(/\d[\d,]*(?=\s*円)|\d{1,3}(?:,\d{3})+/g) ?? [];
    for (const s of m) {
      const n = parseInt(s.replace(/,/g, ""), 10);
      if (Number.isFinite(n) && n >= 10 && n <= 9_999_999) fallback.push(n);
    }
  }
  return fallback.length ? Math.max(...fallback) : null;
}
