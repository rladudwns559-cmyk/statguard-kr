# StatGuard-KR 한국어 수치 주장 벤치마크 v0.1

LLM이 표(CSV)를 보고 쓴 한국어 답변의 **수치 주장**을 검증하는 연구용 데이터셋입니다. 2026 하반기 SW·AI 융합연구개발 일반과제 StatGuard-KR에서 만들었습니다.

## 구성

- 질문 120개(본 세트 88 · 별도 검증 세트 32), 표 8종, 답변 불가 질문 19개 포함
- 각 질문의 기대값은 모델 답변이 아니라 계산 엔진과 별도의 분수(Fraction) 계산으로 만들었고, 그 계산 정의를 `calculation`에 담았습니다.
- `answers_gpt-6-luna_A.jsonl`: gpt-6-luna가 CSV와 질문만 보고 쓴 답변(조건 A, 1회차). 오답 27개. 각 답변에 StatGuard(규칙 v0.7) 판정과, 재계산 근거를 돌려줬을 때 고쳐졌는지(근거 교정)·단순 재확인으로 고쳐졌는지를 함께 기록했습니다.

## 필드

- questions.jsonl: `id, benchmark, split, table, domain, category, question, answerable, expected_value, unit, statguard_supported, calculation`
- answers: `id, model, condition, answer, final_value, correct, error_kind, statguard_rule_v0_7(FLAG|PASS|HOLD), statguard_flag, corrected_with_evidence_round, fixed_by_plain_recheck`
- 채점: 답변 마지막 줄 ‘최종값’이 기대값과 답변 자릿수 기준 반올림 범위(±0.5×10^-자릿수) 안이면 정답. 답변 불가 질문은 ‘판단불가’만 정답.

## 출처와 라이선스

- NOAA NCEI GSOM·GHCN-Daily(시애틀·LA·뉴욕·시카고 2023), NOAA GML 마우나로아 CO₂(2024): 미국 정부 공개 자료
- World Bank WDI(대한민국 인구·실업률, 2023 국가별 지표): CC BY 4.0
- 합성 예제 1종(방문자 수)은 실측 자료가 아닙니다.
- 숫자는 원본과 같고 열 이름만 한국어로 바꿨습니다. 질문·기대값·답변 주석은 CC BY 4.0으로 공개합니다(출처: StatGuard-KR 팀).

## 한계

- 모델 1종, 소규모(질문 120개). 일반화된 성능 순위로 쓰지 마세요.
- 모델 답변은 같은 질문에도 매번 달라질 수 있습니다(반복 실행 결과는 저장소의 experiments/STABILITY.md).

## 파일

| 파일 | 크기 | SHA-256 앞부분 |
|---|---|---|
| `answers_gpt-6-luna_A.jsonl` | 51,528 B | `e53d3f73891d0316…` |
| `questions.jsonl` | 54,767 B | `b95e74cba44bacd3…` |
| `tables/01_시애틀_2023_월별강수량.csv` | 330 B | `3ef535226c51a29e…` |
| `tables/02_마우나로아_2024_월별CO2.csv` | 207 B | `763e55ff8ee2060d…` |
| `tables/03_대한민국_2022_2023_총인구.csv` | 69 B | `77d5218950dca7f5…` |
| `tables/04_대한민국_2014_2023_인구_실업률.csv` | 229 B | `71103019a0c8e2bc…` |
| `tables/05_방문자_합성예제.csv` | 125 B | `7e502c9b68c65fc9…` |
| `tables/06_시애틀_2023_일별기상.csv` | 9,760 B | `07e75455bd3f6431…` |
| `tables/07_미국4개도시_2023_일별기상.csv` | 49,188 B | `83b8130646914576…` |
| `tables/08_세계_국가별_2023_지표.csv` | 14,419 B | `12dda11dcdb05a79…` |
