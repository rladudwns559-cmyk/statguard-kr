import { calculationClientHeader, calculationEndpoint, CalculationError, cloudCalculation, localCalculationAvailable, type Usage } from './calculationClient';

export type ClaimStatus = 'VERIFIED' | 'CONTRADICTED' | 'UNCERTAIN' | 'INSUFFICIENT_EVIDENCE';
export const STATUSES: ClaimStatus[] = ['VERIFIED', 'CONTRADICTED', 'UNCERTAIN', 'INSUFFICIENT_EVIDENCE'];
export type ClaimSpec = { operation: string; column: string; filters: Record<string, string>; reference_filters: Record<string, string> | null };
export type Claim = {
  claim_id: string; sentence: string; status: ClaimStatus; reason_code: string; operation: string | null;
  spec: ClaimSpec | null; notes: string[]; interpretive: boolean; column?: string;
  claimed: { text: string; value: string | null; unit: string | null; unit_stated: boolean; tolerance: string; approximate: boolean; target?: string; significant?: boolean; comparator?: string } | null;
  computed: { value: string; unit: string; expression: string; usage: Usage; reference_usage: Usage | null; extra?: Record<string, unknown> | null } | null;
  difference?: { signed: string; absolute: string; unit: string; relative_percent: string | null };
};
export type AnswerVerification = { extractor: string; claims: Claim[]; summary: Record<ClaimStatus, number>; scope: string };
export type AnswerRequest = { mode: 'verify_answer'; request_id: string; csv_base64: string; source_sha256: string; preview_sha256: string; encoding: 'utf-8-sig' | 'cp949'; units: Record<string, string>; answer_text: string };

export const STATUS_LABEL: Record<ClaimStatus, string> = {
  VERIFIED: '계산 일치', CONTRADICTED: '계산 불일치', UNCERTAIN: '해석 불확실 · 보류', INSUFFICIENT_EVIDENCE: '근거 부족 · 보류',
};
export const REASONS: Record<string, string> = {
  WITHIN_ROUNDING_OF_STATED_PRECISION: '답변에 적힌 자릿수로 반올림하면 재계산 값과 같습니다.',
  NUMERIC_VALUE_CONFLICT: '답변의 수치가 재계산 값과 반올림 범위를 넘어 다릅니다.',
  INTERPRETIVE_STATEMENT: '원인·영향·유의성 같은 해석은 CSV 계산만으로 확인할 수 없어 판정을 보류했습니다.',
  AMBIGUOUS_COLUMN: '한 문장에 여러 숫자 열이 언급되어 어떤 열을 계산할지 정할 수 없습니다.',
  COLUMN_NOT_IDENTIFIED: '어떤 열에 대한 수치인지 문장에서 찾지 못했습니다. 열 이름이 드러나게 질문·답변을 확인하세요.',
  UNIT_NOT_CONFIRMED: '언급된 열의 단위가 확인되지 않아 계산하지 않았습니다. 위에서 단위를 입력하세요.',
  UNIT_MISMATCH: '답변의 단위와 열·계산 결과의 단위가 달라 비교하지 않았습니다.',
  DATA_NOT_COVERED: '답변이 말하는 기간·대상이 CSV에 없습니다.',
  UNSUPPORTED_OPERATION: '회귀·기울기·순위는 아직 지원하지 않는 계산이라 판정하지 않았습니다.',
  OPERATION_NOT_IDENTIFIED: '어떤 계산(합계·평균·증감률·비율·통계 등)인지 문장에서 알 수 없고, 한 행으로 특정되지도 않습니다.',
  REFERENCE_NOT_IDENTIFIED: '증감률의 기준 시점을 문장에서 정할 수 없습니다.',
  CHANGE_RATE_NOT_STATED: '증감을 말하지만 % 수치가 없어 증감률을 비교하지 않았습니다.',
  MULTIPLE_VALUES_FOR_ONE_COLUMN: '같은 열의 값이 여러 개 언급되어 범위를 정할 수 없습니다.',
  RATIO_SUBJECT_NOT_IDENTIFIED: '비율의 대상(분자)을 정할 수 없습니다.',
  CONDITION_FILTER_UNSUPPORTED: '‘0mm보다 큰 날’처럼 조건을 만족하는 행을 세거나 고르는 계산은 아직 지원하지 않아 보류했습니다.',
  SCOPE_FROM_PREVIOUS_SENTENCE: '앞 문장에서 정한 대상(도시·기간 등)을 이어받는 문장이라, 이 문장만으로는 계산 범위를 정할 수 없어 보류했습니다.',
  RATIO_SCOPE_NOT_STATED: '비율의 분모(전체 범위)가 문장에 드러나지 않아 보류했습니다.',
  RANGE_FILTER_UNSUPPORTED: '‘2016~2020년’, ‘상반기’처럼 일부 기간을 고르는 범위 계산은 아직 지원하지 않아 보류했습니다.',
  CLAIM_VALUE_NOT_IDENTIFIED: '주장한 수치를 숫자로 읽을 수 없습니다.',
  MISSING_VALUES_IN_RANGE: '계산 범위에 빈 값이 있어 계산하지 않았습니다.',
  INVALID_NUMBERS_IN_RANGE: '계산 범위에 잘못된 숫자가 있습니다.',
  NO_NUMERIC_ROWS: '계산할 숫자 행이 없습니다.', NON_POSITIVE_BASELINE: '기준 값이 0 이하라 증감률을 계산할 수 없습니다.',
  ZERO_DENOMINATOR: '분모가 0이라 비율을 계산할 수 없습니다.', OVERLAPPING_COMPARISON: '비교하는 두 범위가 겹칩니다.',
  UNKNOWN_COLUMN: 'CSV에 없는 열입니다.',
  INSUFFICIENT_ROWS: '통계를 계산하기에 행이 너무 적습니다.', ZERO_VARIANCE: '값이 모두 같아 상관계수·t-검정을 계산할 수 없습니다.',
  EXTREME_ROW_CONFLICT: '최댓값·최솟값 자체는 맞지만, 답변이 지목한 행(기간·대상)이 실제로 가장 크거나 작은 행이 아닙니다.',
  SIGNIFICANCE_MATCHES_ALPHA_005: 'Welch t-검정(양측, 유의수준 0.05) 결과와 답변의 유의성 판단이 같습니다.',
  SIGNIFICANCE_CONFLICT_ALPHA_005: 'Welch t-검정(양측, 유의수준 0.05) 결과와 답변의 유의성 판단이 반대입니다.',
  INEQUALITY_HOLDS: '답변의 부등식(예: p < 0.05)이 재계산 값에서 성립합니다.',
  GROUPED_STATISTIC_AMBIGUOUS: '‘지역별’처럼 집단마다 여러 행이 있어, 집단 합계의 통계인지 전체 행의 통계인지 정할 수 없어 보류했습니다.',
  CORRELATION_COLUMNS_NOT_IDENTIFIED: '상관계수를 계산할 두 숫자 열을 문장에서 찾지 못했습니다.',
};
export const NOTES: Record<string, string> = {
  COLUMN_INFERRED_FROM_UNIT: '열 이름이 없어 단위가 같은 유일한 열로 연결했습니다.',
  COLUMN_INFERRED_ONLY_MEASURE: '열 이름이 없어 단위를 확인한 유일한 열로 연결했습니다.',
  REFERENCE_FROM_PREVIOUS_PERIOD: '‘전년/전월’을 자료의 직전 시점으로 해석했습니다.',
  LEVEL_VALUE_IN_CHANGE_SENTENCE: '증감 문장 안의 시점별 값입니다.',
  YEAR_COVERS_ALL_ROWS: '언급된 연도가 자료 전체 행과 같습니다.',
  SAMPLE_DEFINITION_MATCH: '표본 기준(n−1로 나눔) 값과 일치합니다.',
  POPULATION_DEFINITION_MATCH: '모집단 기준(n으로 나눔) 값과 일치합니다. 답변이 정의를 밝히지 않아 두 정의를 모두 확인했습니다.',
  WELCH_T_TEST_TWO_SIDED_ALPHA_005: '두 집단의 등분산을 가정하지 않는 Welch t-검정(양측)으로 다시 계산했습니다. p값은 부동소수점 근사입니다.',
  RANGE_COVERS_ALL_ROWS: '언급된 기간이 자료 전체 행과 같아 전체 행으로 계산했습니다.',
  YEAR_PREFIX_FILTER_UNSUPPORTED: '연도만으로 일부 행을 고르는 조건은 아직 지원하지 않아 전체 행을 기준으로 했습니다.',
};
export const OPERATION_LABEL: Record<string, string> = { sum: '합계', mean: '평균', percent_change: '증감률', ratio_percent: '비율', lookup: '값 조회', stdev: '표준편차', variance: '분산', median: '중앙값', max: '최댓값', min: '최솟값', correlation: '상관계수', t_test: 't-검정' };

const MESSAGES: Record<string, string> = {
  ANSWER_TEXT_REQUIRED: '검증할 AI 답변을 입력해 주세요.', ANSWER_TEXT_LIMIT: '답변은 6,000자 이내로 입력해 주세요.',
  UNIT_CONFIRMATION_REQUIRED: '숫자 열 하나 이상의 단위를 입력해 주세요.', INVALID_UNIT_METADATA: '단위는 32자 이내로 입력해 주세요.',
  SOURCE_MISMATCH: '확인한 CSV가 달라졌습니다. 자료를 다시 선택해 주세요.', PREVIEW_INTERPRETATION_MISMATCH: '미리보기와 엔진의 CSV 해석이 다릅니다.',
  ENGINE_BUSY: '다른 작업이 진행 중입니다. 잠시 뒤 다시 시도해 주세요.', ENGINE_TIMEOUT: '검증 시간이 초과되었습니다.',
};
const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export function validateAnswer(payload: unknown, request: AnswerRequest): AnswerVerification {
  const fail = () => { throw new CalculationError('검증 결과가 현재 자료·답변과 연결되는지 확인할 수 없어 표시하지 않았습니다.'); };
  if (!obj(payload) || payload.ok !== true || payload.request_id !== request.request_id || payload.preview_sha256 !== request.preview_sha256 ||
      payload.source_sha256 !== request.source_sha256 || payload.verification_version !== 'statguard-answer-verification-v0.1' || !obj(payload.verification)) return fail();
  const v = payload.verification;
  if (!Array.isArray(v.claims) || v.claims.length > 20 || !obj(v.summary)) return fail();
  for (const c of v.claims) {
    if (!obj(c) || !STATUSES.includes(c.status as ClaimStatus) || typeof c.sentence !== 'string' || typeof c.reason_code !== 'string') return fail();
    if ((c.status === 'VERIFIED' || c.status === 'CONTRADICTED') && (!obj(c.computed) || !obj(c.claimed) || !obj(c.spec))) return fail();
  }
  const summary = v.summary as Record<string, unknown>;
  if (STATUSES.some(s => summary[s] !==(v.claims as Claim[]).filter(c => c.status === s).length)) return fail();
  return v as unknown as AnswerVerification;
}

export async function verifyAnswer(request: AnswerRequest, signal: AbortSignal): Promise<AnswerVerification> {
  if (!localCalculationAvailable()) throw new CalculationError('이 주소에서는 검증 엔진을 사용할 수 없습니다.');
  const response = await fetch(calculationEndpoint(), { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-StatGuard-Client': calculationClientHeader() }, body: JSON.stringify(request), cache: 'no-store', credentials: 'omit', redirect: 'error', signal });
  let payload: unknown;
  try { payload = await response.json(); } catch { throw new CalculationError('검증 엔진에 연결하지 못했습니다.'); }
  if (!response.ok || !obj(payload) || payload.ok !== true) {
    const code = obj(payload) && obj(payload.error) && typeof payload.error.code === 'string' ? payload.error.code : '';
    throw new CalculationError(MESSAGES[code] || '검증을 완료하지 못했습니다. CSV·단위·답변을 다시 확인해 주세요.');
  }
  return validateAnswer(payload, request);
}

/**
 * Live demo: ask the model about this CSV, then verify its answer.
 * Local: the launcher started with --live. Public site: password-protected endpoint, off unless configured.
 */
export type LiveStatus = { enabled: boolean; remaining: number; model: string; password: boolean };
const LIVE_OFF: LiveStatus = { enabled: false, remaining: 0, model: '', password: false };
export async function liveStatus(): Promise<LiveStatus> {
  if (!localCalculationAvailable()) return LIVE_OFF;
  const cloud = cloudCalculation();
  try {
    const response = await fetch(cloud ? '/api/statguard_ask' : '/__statguard/live-status', { cache: 'no-store', credentials: 'omit' });
    const payload: unknown = await response.json();
    if (!obj(payload) || payload.ok !== true || typeof payload.enabled !== 'boolean') return LIVE_OFF;
    return { enabled: payload.enabled, remaining: Number(payload.remaining) || 0, model: String(payload.model ?? ''), password: cloud };
  } catch { return LIVE_OFF; }
}
const LIVE_MESSAGES: Record<string, string> = {
  QUESTION_REQUIRED: '질문을 입력해 주세요.', QUESTION_TOO_LONG: '질문은 500자 이내로 입력해 주세요.',
  LIVE_ASK_LIMIT: '쓸 수 있는 질문 횟수를 모두 사용했습니다. 잠시 뒤 다시 시도하거나 답변을 직접 붙여 넣어 검증하세요.', LIVE_ASK_DISABLED: 'AI 질문 기능이 꺼져 있습니다.',
  CSV_TOO_LARGE_FOR_LIVE_ASK: 'AI 질문은 200KB 이하 CSV에서만 사용할 수 있습니다.', LIVE_ASK_NOT_CONFIGURED: 'API 키가 설정되지 않았습니다.',
  DEMO_PASSWORD_INVALID: '시연 비밀번호가 맞지 않습니다.', DEMO_LOCKED: '비밀번호를 여러 번 틀려 잠시 사용할 수 없습니다.',
  LIVE_ASK_BUSY: '다른 질문을 처리하는 중입니다. 잠시 뒤 다시 시도해 주세요.', REQUEST_TOO_LARGE: 'AI 질문은 200KB 이하 CSV에서만 사용할 수 있습니다.',
};
export async function askLive(request: { csv_base64: string; encoding: 'utf-8-sig' | 'cp949'; question: string; password?: string }, signal: AbortSignal): Promise<{ answer: string; model: string; remaining: number | null }> {
  const cloud = cloudCalculation();
  const { password, ...rest } = request;
  const body = cloud ? { ...rest, password: password ?? '' } : rest;
  const response = await fetch(cloud ? '/api/statguard_ask' : '/__statguard/ask', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-StatGuard-Client': cloud ? 'cloud-v0.1' : 'local-v0.1' }, body: JSON.stringify(body), cache: 'no-store', credentials: 'omit', redirect: 'error', signal });
  let payload: unknown;
  try { payload = await response.json(); } catch { throw new CalculationError('AI 답변을 받지 못했습니다. 잠시 뒤 다시 시도해 주세요.'); }
  if (!response.ok || !obj(payload) || payload.ok !== true || typeof payload.answer !== 'string') {
    const code = obj(payload) && obj(payload.error) && typeof payload.error.code === 'string' ? payload.error.code : '';
    throw new CalculationError(LIVE_MESSAGES[code] || 'AI 답변을 받지 못했습니다. 잠시 뒤 다시 시도해 주세요.');
  }
  return { answer: payload.answer, model: String(payload.model ?? ''), remaining: typeof payload.remaining === 'number' ? payload.remaining : null };
}
