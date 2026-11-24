/** Word-level diff (LCS) for showing what the model changed when it corrected its answer or report. */
export type DiffPart = { text: string; kind: 'same' | 'del' | 'ins' };

export function wordDiff(before: string, after: string): DiffPart[] {
  const a = before.split(/(\s+)/).filter(Boolean), b = after.split(/(\s+)/).filter(Boolean);
  const n = a.length, m = b.length;
  if (n * m > 600_000) return [{ text: before, kind: 'del' }, { text: after, kind: 'ins' }];
  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: DiffPart[] = [];
  const push = (text: string, kind: DiffPart['kind']) => { const last = out[out.length - 1]; if (last && last.kind === kind) last.text += text; else out.push({ text, kind }); };
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { push(a[i], 'same'); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) push(a[i++], 'del');
    else push(b[j++], 'ins');
  }
  while (i < n) push(a[i++], 'del');
  while (j < m) push(b[j++], 'ins');
  return out;
}
