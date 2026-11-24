import { describe, expect, it } from 'vitest';
import { wordDiff } from '../statguard/textDiff';

describe('wordDiff', () => {
  it('marks only the changed words', () => {
    const d = wordDiff('표준편차는 약 7.9℃입니다.', '표준편차는 약 7.6333℃입니다.');
    expect(d.filter(p => p.kind === 'del').map(p => p.text.trim())).toEqual(['7.9℃입니다.']);
    expect(d.filter(p => p.kind === 'ins').map(p => p.text.trim())).toEqual(['7.6333℃입니다.']);
    expect(d.map(p => p.kind === 'del' ? '' : p.text).join('')).toBe('표준편차는 약 7.6333℃입니다.');
  });
  it('handles identical and empty text', () => {
    expect(wordDiff('같다', '같다')).toEqual([{ text: '같다', kind: 'same' }]);
    expect(wordDiff('', '새 문장')).toEqual([{ text: '새 문장', kind: 'ins' }]);
  });
});
