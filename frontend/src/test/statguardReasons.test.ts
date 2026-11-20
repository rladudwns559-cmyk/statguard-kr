import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NOTES, REASONS } from '../statguard/answerClient';

// Every reason/note the rule extractor can emit must have a Korean explanation on screen (never a raw code).
const claims = readFileSync(resolve(__dirname, '../../../src/when2warn/statguard/claims.py'), 'utf-8');
describe('verdict reasons shown to users', () => {
  it('has a message for every reason code the extractor emits', () => {
    const codes = new Set([...claims.matchAll(/"(?:UNCERTAIN|INSUFFICIENT_EVIDENCE|VERIFIED|CONTRADICTED)",\s*"([A-Z0-9_]+)"/g)].map(m => m[1]));
    for (const m of claims.matchAll(/\("(?:UNCERTAIN|INSUFFICIENT_EVIDENCE)", "([A-Z0-9_]+)"\)/g)) codes.add(m[1]);
    for (const s of ['VERIFIED', 'CONTRADICTED', 'UNCERTAIN', 'INSUFFICIENT_EVIDENCE']) codes.delete(s);
    expect(codes.size).toBeGreaterThan(15);
    expect([...codes].filter(c => !REASONS[c])).toEqual([]);
  });
  it('has a message for every note the extractor attaches', () => {
    const notes = new Set([...claims.matchAll(/notes"\]\.append\("([A-Z0-9_]+)"\)/g)].map(m => m[1]));
    expect([...notes].filter(n => !NOTES[n])).toEqual([]);
  });
  it('does not call supported statistics unsupported', () => {
    expect(REASONS.UNSUPPORTED_OPERATION).not.toMatch(/표준편차|상관/);
  });
});
