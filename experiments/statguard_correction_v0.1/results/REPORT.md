# StatGuard 자동 교정 실험 결과 v0.1

모델 gpt-6-luna, 검증기 rule v0.7 (frozen), 최대 2라운드. 조건은 PROTOCOL.md(실행 전 고정).

## 정답률 (조건 A 답변에서 출발)

| 묶음 | 문항 | A 원래 | R 단순 재확인 1R | S StatGuard 근거 1R | R 2R | S 2R | 교정 대상 |
|---|---|---|---|---|---|---|---|
| 전체 | 120 | 93/120 (77.5%) | 96/120 (80.0%) | 100/120 (83.3%) | 95/120 (79.2%) | 103/120 (85.8%) | 50 |
| v0.1 | 54 | 51/54 (94.4%) | 53/54 (98.1%) | 52/54 (96.3%) | 53/54 (98.1%) | 54/54 (100.0%) | 20 |
| v0.2 | 44 | 30/44 (68.2%) | 31/44 (70.5%) | 33/44 (75.0%) | 30/44 (68.2%) | 34/44 (77.3%) | 19 |
| v0.3 | 22 | 12/22 (54.5%) | 12/22 (54.5%) | 15/22 (68.2%) | 12/22 (54.5%) | 15/22 (68.2%) | 11 |
| 본 세트 | 88 | 65/88 (73.9%) | 68/88 (77.3%) | 72/88 (81.8%) | 67/88 (76.1%) | 75/88 (85.2%) | 39 |
| 별도 검증 세트 | 32 | 28/32 (87.5%) | 28/32 (87.5%) | 28/32 (87.5%) | 28/32 (87.5%) | 28/32 (87.5%) | 11 |

## 고침·망침 (전체, 1라운드 / 2라운드)

| 조건 | 오답→정답 | 정답→오답 | 통과(PASS) 답변 중 오답 |
|---|---|---|---|
| R 단순 재확인 | 4 / 4 | 1 / 2 | 0 / 0 |
| S StatGuard 근거 | 9 / 11 | 2 / 1 | 0 / 0 |

## 원래 답변에 대한 StatGuard 판정별 (전체, 1라운드 정답 수)

| 원래 판정 | 대상 | A | R | S |
|---|---|---|---|---|
| FLAG | 8 | 0 | 0 | 7 |
| HOLD | 42 | 23 | 26 | 23 |

비용: 호출 182회, 입력 1,767,541 / 출력 182,803 토큰, 추정 $0.2682 (사전 고정 단가, 청구액 아님).

## 문항별 (A → R1·R2 / S1·S2, O 정답 X 오답, 괄호는 StatGuard 판정)

| 문항 | R | S |
|---|---|---|
| v0.1:P01 | O(HOLD) → O(HOLD) → O(HOLD) | O(HOLD) → O(PASS) |
| v0.1:S04 | X(HOLD) → O(HOLD) → O(HOLD) | X(HOLD) → X(HOLD) → O(HOLD) |
| v0.1:S05 | O(HOLD) → O(PASS) | O(HOLD) → O(FLAG) → O(FLAG) |
| v0.1:S06 | O(HOLD) → O(HOLD) → O(HOLD) | O(HOLD) → O(HOLD) → O(HOLD) |
| v0.1:C01 | O(HOLD) → O(PASS) | O(HOLD) → O(PASS) |
| v0.1:C04 | O(HOLD) → O(HOLD) → O(PASS) | O(HOLD) → O(PASS) |
| v0.1:C06 | X(HOLD) → X(HOLD) → X(HOLD) | X(HOLD) → X(HOLD) → O(HOLD) |
| v0.1:K02 | X(HOLD) → O(HOLD) → O(HOLD) | X(HOLD) → O(HOLD) → O(HOLD) |
| v0.1:K05 | O(HOLD) → O(HOLD) → O(HOLD) | O(HOLD) → O(PASS) |
| v0.1:K08 | O(HOLD) → O(HOLD) → O(HOLD) | O(HOLD) → O(HOLD) → O(HOLD) |
| v0.1:V01 | O(HOLD) → O(HOLD) → O(HOLD) | O(HOLD) → O(PASS) |
| v0.1:V05 | O(HOLD) → O(HOLD) → O(HOLD) | O(HOLD) → O(HOLD) → O(HOLD) |
| v0.1:V06 | O(HOLD) → O(HOLD) → O(HOLD) | O(HOLD) → O(PASS) |
| v0.1:V07 | O(HOLD) → O(HOLD) → O(HOLD) | O(HOLD) → O(HOLD) → O(PASS) |
| v0.1_holdout:H01 | O(HOLD) → O(HOLD) → O(HOLD) | O(HOLD) → O(HOLD) → O(HOLD) |
| v0.1_holdout:H02 | O(HOLD) → O(FLAG) → O(FLAG) | O(HOLD) → O(HOLD) → O(PASS) |
| v0.1_holdout:H03 | O(HOLD) → O(HOLD) → O(HOLD) | O(HOLD) → O(FLAG) → O(FLAG) |
| v0.1_holdout:H05 | O(HOLD) → O(HOLD) → O(HOLD) | O(HOLD) → O(PASS) |
| v0.1_holdout:H12 | O(HOLD) → O(HOLD) → O(HOLD) | O(HOLD) → O(HOLD) → O(PASS) |
| v0.1_holdout:H18 | O(HOLD) → O(HOLD) → O(HOLD) | O(HOLD) → O(HOLD) → O(HOLD) |
| v0.2:W08 | X(FLAG) → X(FLAG) → X(HOLD) | X(FLAG) → O(PASS) |
| v0.2:F06 | X(HOLD) → X(HOLD) → X(HOLD) | X(HOLD) → X(HOLD) → X(HOLD) |
| v0.2:W01 | X(FLAG) → X(FLAG) → O(PASS) | X(FLAG) → O(PASS) |
| v0.2:W07 | O(HOLD) → O(HOLD) → O(HOLD) | O(HOLD) → O(HOLD) → O(PASS) |
| v0.2:W09 | O(HOLD) → X(FLAG) → X(HOLD) | O(HOLD) → X(FLAG) → O(PASS) |
| v0.2:W10 | X(FLAG) → X(FLAG) → X(FLAG) | X(FLAG) → O(HOLD) → O(HOLD) |
| v0.2:W12 | X(FLAG) → X(FLAG) → X(FLAG) | X(FLAG) → O(FLAG) → O(FLAG) |
| v0.2:W14 | O(HOLD) → O(HOLD) → X(HOLD) | O(HOLD) → X(HOLD) → X(HOLD) |
| v0.2:F02 | X(HOLD) → X(HOLD) → X(HOLD) | X(HOLD) → X(HOLD) → X(HOLD) |
| v0.2:F03 | X(HOLD) → X(HOLD) → X(HOLD) | X(HOLD) → X(HOLD) → X(HOLD) |
| v0.2:F09 | X(HOLD) → O(PASS) | X(HOLD) → X(HOLD) → X(HOLD) |
| v0.2:F10 | X(HOLD) → O(HOLD) → X(HOLD) | X(HOLD) → X(HOLD) → X(HOLD) |
| v0.2:F11 | O(HOLD) → O(HOLD) → O(FLAG) | O(HOLD) → O(HOLD) → O(HOLD) |
| v0.2:F12 | X(FLAG) → X(FLAG) → X(FLAG) | X(FLAG) → O(PASS) |
| v0.2_holdout:LH05 | X(HOLD) → X(HOLD) → X(HOLD) | X(HOLD) → X(HOLD) → X(FLAG) |
| v0.2_holdout:LH06 | O(HOLD) → O(PASS) | O(HOLD) → O(PASS) |
| v0.2_holdout:LH10 | X(HOLD) → X(HOLD) → X(HOLD) | X(HOLD) → X(HOLD) → X(HOLD) |
| v0.2_holdout:LH12 | X(FLAG) → X(FLAG) → X(FLAG) | X(FLAG) → X(FLAG) → X(FLAG) |
| v0.2_holdout:LH13 | X(HOLD) → X(HOLD) → X(HOLD) | X(HOLD) → X(HOLD) → X(HOLD) |
| v0.3:R02 | X(FLAG) → X(HOLD) → X(HOLD) | X(FLAG) → O(HOLD) → O(PASS) |
| v0.3:R04 | X(HOLD) → X(FLAG) → X(FLAG) | X(HOLD) → O(PASS) |
| v0.3:R07 | X(FLAG) → X(HOLD) → X(HOLD) | X(FLAG) → O(PASS) |
| v0.3:R08 | X(HOLD) → X(HOLD) → X(HOLD) | X(HOLD) → X(FLAG) → X(HOLD) |
| v0.3:R09 | X(HOLD) → X(HOLD) → X(HOLD) | X(HOLD) → X(HOLD) → X(HOLD) |
| v0.3:R10 | X(HOLD) → X(HOLD) → X(HOLD) | X(HOLD) → X(HOLD) → X(HOLD) |
| v0.3:R11 | X(HOLD) → X(HOLD) → X(FLAG) | X(HOLD) → X(HOLD) → X(HOLD) |
| v0.3:R15 | O(HOLD) → O(HOLD) → O(HOLD) | O(HOLD) → O(PASS) |
| v0.3:R16 | X(HOLD) → X(HOLD) → X(HOLD) | X(HOLD) → X(HOLD) → X(HOLD) |
| v0.3:R17 | X(HOLD) → X(FLAG) → X(HOLD) | X(HOLD) → X(HOLD) → X(HOLD) |
| v0.3:R18 | X(HOLD) → X(HOLD) → X(HOLD) | X(HOLD) → X(HOLD) → X(HOLD) |
