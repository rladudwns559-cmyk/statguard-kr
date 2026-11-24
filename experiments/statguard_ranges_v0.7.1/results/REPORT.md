# 규칙 추출기 v0.7 vs v0.7.1 결과

저장된 답변 1492개. 조건은 PROTOCOL.md. API 호출 없음.

| 규칙 | 묶음 | 판 | 통과 | 통과 중 오답 | 정답을 FLAG(오경보) | 오답 중 FLAG | 보류 |
|---|---|---|---|---|---|---|---|
| 사전 등록 규칙 | 전체 | v0.7 | 485 | **13** | **66** | 183 | 758 |
| 사전 등록 규칙 | 전체 | v0.7.1 | 504 | **13** | **66** | 183 | 739 |
| 사전 등록 규칙 | 처음 적용(G2) | v0.7 | 380 | **12** | **57** | 134 | 561 |
| 사전 등록 규칙 | 처음 적용(G2) | v0.7.1 | 395 | **12** | **57** | 134 | 546 |
| 최종값 규칙 | 전체 | v0.7 | 420 | **1** | **66** | 183 | 823 |
| 최종값 규칙 | 전체 | v0.7.1 | 439 | **1** | **66** | 183 | 804 |
| 최종값 규칙 | 처음 적용(G2) | v0.7 | 330 | **1** | **57** | 134 | 611 |
| 최종값 규칙 | 처음 적용(G2) | v0.7.1 | 345 | **1** | **57** | 134 | 596 |

| 주장 판정 | v0.7 | v0.7.1 |
|---|---|---|
| VERIFIED | 563 | 585 |
| CONTRADICTED | 285 | 286 |
| UNCERTAIN | 1518 | 1495 |
| INSUFFICIENT_EVIDENCE | 29 | 29 |

범위 때문에 보류된 주장: v0.7 34개 → v0.7.1 11개 (값 묶음으로 계산 24개)

채택 기준(PROTOCOL 4장) 충족: **예**

## 판정이 바뀐 답변 19개 (사전 등록 규칙, 최종값 규칙)

- gpt-6-luna 원래 답변 v0.1:S06 정답: v0.7 ('HOLD', 'HOLD') → v0.7.1 ('PASS', 'PASS')
- gpt-4o-mini 원래 답변 v0.1:S06 정답: v0.7 ('HOLD', 'HOLD') → v0.7.1 ('PASS', 'PASS')
- gpt-6-luna A_r2 v0.1:S06 정답: v0.7 ('HOLD', 'HOLD') → v0.7.1 ('PASS', 'PASS')
- gpt-6-luna A_r3 v0.1:S06 정답: v0.7 ('HOLD', 'HOLD') → v0.7.1 ('PASS', 'PASS')
- gpt-6-luna B v0.1:S06 정답: v0.7 ('HOLD', 'HOLD') → v0.7.1 ('PASS', 'PASS')
- gpt-6-luna C v0.1:S06 정답: v0.7 ('HOLD', 'HOLD') → v0.7.1 ('PASS', 'PASS')
- gpt-6-luna C_r2 v0.1:S06 정답: v0.7 ('HOLD', 'HOLD') → v0.7.1 ('PASS', 'PASS')
- gpt-6-luna C_r3 v0.1:S06 정답: v0.7 ('HOLD', 'HOLD') → v0.7.1 ('PASS', 'PASS')
- gpt-6-luna 교정 R v0.1:S06 정답: v0.7 ('HOLD', 'HOLD') → v0.7.1 ('PASS', 'PASS')
- gpt-6-luna 교정 R v0.1:S06 정답: v0.7 ('HOLD', 'HOLD') → v0.7.1 ('PASS', 'PASS')
- gpt-4o-mini 교정 R v0.1:S06 정답: v0.7 ('HOLD', 'HOLD') → v0.7.1 ('PASS', 'PASS')
- gpt-4o-mini 교정 R v0.1:S06 정답: v0.7 ('HOLD', 'HOLD') → v0.7.1 ('PASS', 'PASS')
- gpt-6-luna 교정 S v0.1:S06 정답: v0.7 ('HOLD', 'HOLD') → v0.7.1 ('PASS', 'PASS')
- gpt-6-luna 교정 S v0.1:S06 정답: v0.7 ('HOLD', 'HOLD') → v0.7.1 ('PASS', 'PASS')
- gpt-4o-mini 교정 S v0.1:S06 정답: v0.7 ('HOLD', 'HOLD') → v0.7.1 ('PASS', 'PASS')
- gpt-6-luna 원래 답변 v0.1_holdout:H01 정답: v0.7 ('HOLD', 'HOLD') → v0.7.1 ('PASS', 'PASS')
- gpt-5-mini 원래 답변 v0.1_holdout:H01 정답: v0.7 ('HOLD', 'HOLD') → v0.7.1 ('PASS', 'PASS')
- gpt-6-luna 교정 R v0.1_holdout:H01 정답: v0.7 ('HOLD', 'HOLD') → v0.7.1 ('PASS', 'PASS')
- gpt-6-luna 교정 R v0.1_holdout:H01 정답: v0.7 ('HOLD', 'HOLD') → v0.7.1 ('PASS', 'PASS')
