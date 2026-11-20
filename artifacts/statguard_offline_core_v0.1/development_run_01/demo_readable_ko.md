# WHEN2WARN StatGuard 첫 계산 검증 결과

합성 개발 사례의 오프라인 검증입니다. 실제 GPT 답변·업로드 서비스·연구 정확도 평가가 아닙니다.

미리 고정한 사례 24개 중 기대 결과 일치: 24개.

| 사례 | 연산 | 실제 결과 또는 거부 이유 | 기대값 일치 |
|---|---|---|---|
| SG-DEV-001 | sum | 4938 명 | 예 |
| SG-DEV-002 | sum | 2638 명 | 예 |
| SG-DEV-003 | mean | 823 명 | 예 |
| SG-DEV-004 | mean | 1089 명 | 예 |
| SG-DEV-005 | ratio_percent | 125 % | 예 |
| SG-DEV-006 | ratio_percent | 80 % | 예 |
| SG-DEV-007 | percent_change | 17.8 % | 예 |
| SG-DEV-008 | percent_change | 20 % | 예 |
| SG-DEV-009 | percent_change | 0 % | 예 |
| SG-DEV-010 | grouped_aggregate | A: 1178, B: 960, C: 500 | 예 |
| SG-DEV-011 | grouped_aggregate | A: 1089, B: 880, C: 500 | 예 |
| SG-DEV-012 | rank | A: 1178 (순위 1), B: 960 (순위 2), C: 500 (순위 3) | 예 |
| SG-DEV-013 | rank | A: 10 (순위 1), B: 10 (순위 1), C: 5 (순위 2) | 예 |
| SG-DEV-014 | 거부 사례 | EMPTY_SELECTION | 예 |
| SG-DEV-015 | 거부 사례 | NON_POSITIVE_BASELINE | 예 |
| SG-DEV-016 | 거부 사례 | ZERO_DENOMINATOR | 예 |
| SG-DEV-017 | 거부 사례 | MISSING_NUMERIC_VALUE | 예 |
| SG-DEV-018 | sum | 10 명 | 예 |
| SG-DEV-019 | 거부 사례 | INVALID_NUMERIC_VALUE | 예 |
| SG-DEV-020 | 거부 사례 | MISSING_GROUP_KEY | 예 |
| SG-DEV-021 | 거부 사례 | UNKNOWN_COLUMN | 예 |
| SG-DEV-022 | 거부 사례 | NON_POSITIVE_BASELINE | 예 |
| SG-DEV-023 | 거부 사례 | OVERLAPPING_COMPARISON | 예 |
| SG-DEV-024 | 거부 사례 | UNSUPPORTED_OPERATION | 예 |

## 설명용 수치 주장 비교

A지역 방문자 1,000명에서 1,178명: (1178 - 1000) / 1000 * 100 = 17.8%.

| 수동 연결한 합성 주장 | 계산 결과 | 판정 |
|---|---|---|
| 23% | 17.8% | CONTRADICTED |
| 17.8% | 17.8% | VERIFIED_WITHIN_SCOPE |

판정은 명시한 데이터·계산·단위와 허용오차 안에서만 유효합니다. 인과 해석이나 전체 답변의 진실을 보장하지 않습니다.

## 아직 연결하지 않은 부분

CSV 업로드 화면·사용자 데이터 저장·GPT 분석과 주장 추출·웹 대화 화면·DB·배포·고급 통계검정·보정은 이번 단계에서 연결하지 않았습니다.

기존 Agent·웹 근거 검증·evaluator 코드와 과거 연구 판정은 보존합니다.
