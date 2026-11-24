# StatGuard-KR

**실행 가능한 통계 검증과 판정 보류를 활용한 LLM 데이터 분석 신뢰성 향상 연구**
SW·AI 융합연구개발 일반과제 (2026 하반기) · 오연우, 이고은, 김영준

LLM이 표(CSV) 데이터를 보고 쓴 답변에서 숫자 주장을 찾아내고, 같은 CSV로 **다시 계산**해 4가지 상태로 판정합니다. 열·기간·단위를 확정할 수 없으면 억지로 판정하지 않고 **보류**합니다.

| 판정 | 의미 |
|---|---|
| 계산 일치 (Verified) | 답변에 적힌 자릿수로 반올림하면 재계산 값과 같음 |
| 계산 불일치 (Contradicted) | 반올림 범위를 넘어 다름 |
| 해석 불확실 · 보류 (Uncertain) | 열·기준 시점·비율 범위가 모호하거나, 원인·유의성 같은 해석 문장 |
| 근거 부족 · 보류 (Insufficient Evidence) | 자료에 없는 기간·대상, 단위 미확인, 지원하지 않는 통계 |

‘계산 일치’는 연결된 계산 하나가 맞다는 뜻이며, 답변 전체의 사실·인과관계·자료의 진실성을 보증하지 않습니다.

## 구조

```text
CSV + AI 답변
  → ① Claim Extractor   규칙 기반(v0.7, 웹 기본) 또는 LLM 구조화 출력(실험용)
  → ② Statistical Executor   Decimal 34자리 결정적 계산 (합계·평균·증감률·비율·값 조회,
                             표준편차·분산·중앙값·최댓값·최솟값·피어슨 상관계수·Welch t-검정)
  → ③ Claim Verifier    자릿수 기준 반올림 비교, 단위 확인
  → ④ 판정·보류          4상태 + 사유 코드 + 계산식·사용한 행
```

| 위치 | 내용 |
|---|---|
| `src/when2warn/statguard/core.py` | CSV 읽기·계산 엔진 (외부 호출 없음) |
| `src/when2warn/statguard/claims.py` | 규칙 기반 주장 추출 + 4상태 판정 (v0.7) |
| `src/when2warn/statguard/llm_extractor.py` | LLM 구조화 출력 추출기 (모델은 계산값을 만들지 않음) |
| `src/when2warn/statguard/live_ask.py` | 시연용 AI 질문 기능(gpt-6-luna). 로컬 `--live` 실행기와 공개 사이트의 비밀번호 보호 엔드포인트(`frontend/api/statguard_ask.py`)에서 사용 |
| `src/when2warn/statguard/local_bridge.py` | 화면 ↔ 엔진 연결 (`calculate` · `compare` · `verify_answer`) |
| `frontend/src/statguard/` | 웹 화면 (직접 계산·수치 비교, AI 답변 검증, 실험 결과) |
| `frontend/api/statguard.py`, `frontend/_statguard_runtime/` | Vercel 배포용 연결과 엔진 사본(원본과 바이트 동일, 해시 검사) |
| `experiments/statguard_benchmark_v0.1/` | 작은 표 벤치마크(2~12행, 36+18문항) |
| `experiments/statguard_benchmark_v0.2/` | 큰 표·통계 벤치마크(365·1,460행, 30+14문항) |
| `experiments/statguard_benchmark_v0.3/` | 도메인 확장 벤치마크(World Bank 176개국, 22문항) |
| `experiments/stability.py`, `STABILITY.md` | 반복 실행(A·C 3회) 안정성 분석 |
| `experiments/export_dataset.py`, `frontend/public/statguard-dataset/` | 한국어 수치 주장 벤치마크 v0.1 공개본(질문 120·답변·판정·표 8종, 설명서 README) |
| `experiments/coverage_risk.py` | 판정 범위–위험 분석(규칙·LLM·결합, API 호출 없음) |
| `experiments/statguard_correction_v0.1/` | 검증 → 교정 실험: StatGuard 근거를 돌려주면 LLM이 고치는지(대조군: 단순 재확인) |
| `tests/test_statguard_*.py`, `frontend/src/test/statguard*.test.tsx` | 자동 테스트 |

## 웹 화면

| 주소 | 내용 |
|---|---|
| `/` | StatGuard-KR 소개(핵심 결과 수치는 실험 결과 파일에서 자동으로 읽음) |
| `/statguard` | 검증하기: CSV 업로드 → **AI 답변 검증** 탭(기본) 또는 **직접 계산·수치 비교** 탭. ‘실제 공개 자료 예시’에서 자료 5종을 바로 불러올 수 있음(★ 시애틀 일별 365행은 gpt-6-luna의 실제 답변 포함) |
| `/statguard/challenge` | AI 오답 체험: 실험에 기록된 실제 답변으로 ‘맞을까 틀릴까’ 5문제 챌린지, 오답 27개 갤러리 |
| `/statguard/results` | 실험 결과(전체 규모, 반복 실행, 큰 표·국가별·작은 표 벤치마크, 한계) |
| `/when2warn` 등 | 이전 WHEN2WARN 서비스 화면(보존, StatGuard 메뉴에서는 연결하지 않음) |

웹의 답변 검증은 **LLM API를 호출하지 않습니다**(규칙 기반 추출). CSV와 답변은 계산에만 쓰이고 저장하지 않습니다.

**AI에게 직접 질문(시연)**: 질문 → gpt-6-luna 답변 → 즉시 검증을 한 번에 보여줍니다. ‘AI에게 분석 보고서 쓰게 하기’는 질문 없이 여러 문단 보고서를 쓰게 한 뒤 보고서 속 숫자를 모두 판정하고(확인한 열 단위를 함께 전달), 불일치·보류가 있으면 ‘근거 보내고 AI에게 고치게 하기’로 고친 뒤 수정 전후 비교를 보여줍니다.
- 로컬: 실행기를 `--live`로 켜면 나타납니다. 실행당 최대 30회, 키는 계산과 분리된 하위 프로세스에만 전달합니다.
- 공개 사이트: Vercel 환경변수 `OPENAI_API_KEY`와 `STATGUARD_DEMO_PASSWORD`가 모두 있을 때만 켜지며, 시연 비밀번호를 입력해야 합니다(`frontend/api/statguard_ask.py`). 서버 인스턴스당 질문 20회, 비밀번호 10회 오입력 시 잠금, 질문 500자·CSV 200KB 제한. 이 제한은 인스턴스별이므로 실제 비용 상한은 OpenAI 프로젝트의 사용 한도로 걸어 두어야 합니다. 두 환경변수 중 하나를 지우고 재배포하면 꺼집니다.

## 로컬 실행

필요: Python 3.11 이상, Node.js 20 이상, pnpm. 새 Python 패키지는 필요하지 않습니다.

```powershell
cd frontend
npx --yes pnpm@11.25.0 install --frozen-lockfile
node scripts/statguard-local.mjs
```

시연 모드(OpenAI API 키 필요, 키 값은 환경변수나 키 파일로만 전달):

```powershell
node scripts/statguard-local.mjs --live --live-env-file ..\.env.retrieval-live.private
```

브라우저에서 `http://127.0.0.1:5173/statguard`를 엽니다. 계산은 이 PC의 Python으로 실행됩니다(`STATGUARD_PYTHON` 환경변수로 Python 경로 지정 가능).

## 테스트

```powershell
$env:PYTHONPATH=(Resolve-Path .\src).Path
python -m unittest tests.test_statguard_offline_v0_1 tests.test_statguard_local_calculation_v0_1 tests.test_statguard_manual_comparison_v0_1 tests.test_statguard_cloud_transport_v0_1 tests.test_statguard_answer_verification_v0_1 tests.test_statguard_llm_extractor_v0_1 tests.test_statguard_statistics_v0_1 tests.test_statguard_live_ask_v0_1 tests.test_statguard_forensics_v0_1 tests.test_statguard_version_sync_v0_1
```

```powershell
cd frontend
npx vitest run --maxWorkers=2
npx tsc --noEmit
node --test scripts/statguard-calculation-plugin.test.mjs
```

## 벤치마크 재현

실험 조건은 실행 전에 [`PROTOCOL.md`](experiments/statguard_benchmark_v0.1/PROTOCOL.md)에 고정했고, 이후 조정도 같은 문서(6-1, 6-2)에 기록했습니다.

**API 없이 결과 다시 계산하기** (저장된 모델 응답 사용, 비용 0):

```powershell
cd experiments\statguard_benchmark_v0.1
python -X utf8 -I build_expected.py
python -X utf8 -I build_expected.py --set holdout
python -X utf8 -I evaluate.py
python -X utf8 -I evaluate.py --set holdout
python -X utf8 -I make_report.py
```

`results/REPORT.md`와 웹 결과 페이지 데이터(`frontend/src/statguard/benchmarkSummary.json`)가 다시 만들어집니다. 큰 표 벤치마크는 `experiments\statguard_benchmark_v0.2`에서 같은 순서로 실행합니다(`build_datasets.py`가 NOAA 원자료에서 자료를 다시 만들고, 결과는 `benchmarkSummaryLarge.json`). 각 실험에 쓴 추출기 버전은 `frozen/` 폴더에 그대로 보관해 있어, 현재 코드가 바뀌어도 같은 결과가 재현됩니다.

**모델 호출부터 다시 하기** (OpenAI API 키 필요, 환경변수 `OPENAI_API_KEY`): `results/cache/`를 지운 뒤 `run_experiment.py answers A|B|C`, `extract-llm A`, `perturb`, `--set holdout`을 실행합니다. 호출 상한은 폴더당 400회이며, 반복 실행까지 포함한 누적 추정은 v0.1 $0.06, v0.2 $0.72, v0.3 $0.22(합계 약 $1.0)입니다. 모델 응답은 매번 달라질 수 있습니다.

## 결과 요약 (gpt-6-luna)

| 항목 | 작은 표 v0.1 (2~12행) | 큰 표 v0.2 (365·1,460행) | 국가별 v0.3 (176행) |
|---|---|---|---|
| 정답률 A 일반 LLM | 33/36 | **20/30** | **12/22** |
| 정답률 B +자료 설명 | 33/36 | 18/30 | 13/22 |
| 정답률 C +계산 도구 | 36/36 | 29/30 | 21/22 |
| StatGuard가 ‘통과’시킨 답변의 오답 | 0건 | 0건 | 0건 |
| 오류 주입 세트 정밀도·재현율 (규칙) | 1.00·1.00 | 1.00·1.00 | 1.00·1.00 |

- **판정 범위–위험**: 일반 LLM 답변 88개 중 검증 없이 쓰면 26.1%가 오답. 규칙(실행 전 고정) 판정 50%·통과 중 오답 0건, LLM 추출 59%·1건, 규칙→보류만 LLM 결합 72%·1건(실제 오답 10건 표시, 규칙 6건).
- **검증 → 교정**: 일반 LLM 답변 120개 중 통과하지 못한 50개에 재계산 근거를 돌려주자 ‘계산 불일치’ 오답 8건 중 7건이 한 번에 고쳐짐(단순 재확인 대조군 0건). 전체 정답률 77.5% → 83.3%(2회 85.8%), 대조군 80.0%. 보류 답변에서는 대조군보다 낫지 않았고, 정답이 틀려진 경우 1~2건. 웹의 ‘근거 보내고 AI에게 고치게 하기’ 버튼이 같은 피드백을 보냄(문구에 “수치는 한 문장에 하나씩” 한 줄 추가, PROTOCOL 변경 기록 참고).
- **반복 3회(A·C)**: 세 벤치마크 × 두 조건 × 3회에서 StatGuard가 통과시킨 답변 **279건 중 오답 0건**. 일반 LLM(A)은 같은 질문에도 회차마다 정답이 바뀌었다(큰 표·국가별에서 문항의 약 20%).
- **오탐**: 실행 전 고정한 규칙 추출기의 오탐은 결과를 보고 고쳤고(v0.3·v0.5·v0.7), v0.3·v0.5는 수정 후 새로 만든 별도 검증 세트에서 오탐 0건을 확인했다.
- **LLM 추출기**는 판정 범위가 넓은 경우도 있지만, 별도 검증 세트 오탐(v0.2 2/4)과 자료에 없는 ‘연도’ 열을 지어내 보류하는 문제(v0.3)가 있었다.

자세한 표는 각 `results/REPORT.md`와 `experiments/STABILITY.md`에 있습니다.

## 비교 실험: LLM 심판 vs StatGuard, 답변 모델 3종 (`experiments/statguard_comparison_v0.1`)

같은 120문항에 답변 모델 3종(gpt-6-luna 기존 답변 + gpt-4o-mini·gpt-5-mini 새 답변)의 답 360개를 놓고, LLM에게 채점을 맡긴 경우(gpt-6-luna 심판)와 StatGuard를 비교했다. 조건은 실행 전 `PROTOCOL.md`에 고정했고, API 잔액 때문에 실행 중 범위를 줄인 내용(gpt-4.1-mini 제외, 추정 비용 상한 $2.00)도 같은 문서 ‘변경 기록’에 남겼다. 실제 추정 비용 약 $2.05.

| 방식 (답 360개) | 통과 | 통과 중 오답 (95% 상한) | 오답 중 지적 |
|---|---|---|---|
| LLM 심판 gpt-6-luna | 235 | **13** (≤9.3%) | 109/133 |
| StatGuard (사전 등록 규칙) | 105 | **1** (≤5.2%) | 49/133 |
| StatGuard 최종값 규칙 (사후 탐색) | 90 | 0 (≤4.0%) | 49/133 |
| 결합: StatGuard 보류분만 LLM 심판 (사후 탐색) | 224 | 7 (≤6.3%) | 115/133 |

- 사전 등록 규칙(불일치 없이 일치가 하나라도 있으면 통과)은 긴 답변에서 **중간 숫자만 맞고 최종값은 보류**인 답을 통과시켰다(전체 1건, 교정 후 gpt-4o-mini 7건·gpt-5-mini 4건). ‘최종값이 재계산과 일치할 때만 통과’ 규칙은 결과를 본 뒤 만든 것이라 `analyze_final_rule.py`에 탐색 분석으로 분리했다.
- 근거 교정: gpt-4o-mini는 계산 불일치 오답 35건 중 **29건**을 고침(단순 재확인 2건), 정답률 44.2% → 68.3%. gpt-5-mini는 15건 중 10건(재확인 8건), 정답률 67.5% → 69.2%로 효과가 작았다.
- 자기 일관성(같은 질문 3회 답이 같으면 통과)도 gpt-6-luna 88문항에서 통과 53개 중 오답 0개로 좋았다(StatGuard 35개 중 0개, LLM 심판 71개 중 8개).
- gpt-5-mini 심판은 예산 한도로 일부(100/360)만 실행해 결론에서 뺐다.

```powershell
cd experiments\statguard_comparison_v0.1
python -X utf8 -I run_comparison.py report      # 저장된 응답으로 집계 (API 호출 없음)
python -X utf8 -I analyze_final_rule.py         # 사후 탐색 분석
cd ..; python -X utf8 -I export_site_comparison.py   # 웹 데이터 benchmarkComparison.json
```

## 오류 역추적 (`src/when2warn/statguard/forensics.py`, `experiments/statguard_forensics_v0.1`)

‘계산 불일치’로 잡힌 숫자마다 흔한 계산 실수(행 하나·두 개 누락, 평균↔중앙값·표준편차↔분산, 개수 잘못 셈, 다른 열·범위, 조건 누락, 자릿수, 앞 문장의 틀린 숫자 재사용, 단측 p값)를 정해진 목록에서 다시 계산해, AI의 숫자가 답변 자릿수로 정확히 재현되는 실수를 찾는다. LLM을 쓰지 않는다. 후보 값들이 올바른 값 ±20% 구간을 덮는 비율로 **우연 일치 확률**을 계산해 0.25 이상이면 설명을 내지 않고, 0.05 미만이며 후보가 하나일 때만 ‘확신 높음’으로 표시한다. 한 문장에 숫자가 여러 개이거나 문장에 다른 열 이름이 나오면 AI의 실수로 단정하지 않고 ‘다른 범위(열)의 값과 일치 — StatGuard가 잘못 연결했을 수 있음’으로 표시한다.

- 검증(시드 20261201, 기준을 고정한 뒤 처음 쓴 시드): 일부러 넣은 계산 실수 **182개 중 166개(91.2%)** 원인을 맞게 찾음, 이유 없이 틀린 숫자 316개 중 16개(5.1%)에만 설명(‘확신 높음’ 4개, 1.3%).
- 실제 오답: 계산 불일치 gpt-6-luna 9개 중 4개, gpt-4o-mini 43개 중 4개, gpt-5-mini 17개 중 7개 재현. 예: “고소득 국가 60개 평균 44,871.10달러” → 61개국 중 Guyana를 빼면 정확히 같은 값(답변도 60개라고 적음).
- 웹: 검증 결과의 불일치 카드에 ‘왜 틀렸을까’ 상자, AI 오답 갤러리·챌린지에 원인 표시, 홈에 사례.

```powershell
cd experiments\statguard_forensics_v0.1
python -X utf8 -I run_eval.py 20261201
```

## 선행연구와의 차이

PAL(ICML 2023), CRITIC(ICLR 2024), Chain-of-Verification(ACL Findings 2024)은 답 생성·비평·검증에 LLM을 쓴다. StatGuard-KR은 LLM 없이 사용자의 CSV로 결정적으로 재계산해 어떤 답변이든 사후 판정하고, 확정할 수 없으면 사유와 함께 보류하며, 그 근거로 교정까지 잇는다. 외부 피드백 없는 자기 교정의 한계(Huang 외, ICLR 2024)를 대조군으로 재확인했고, 표·통계에서의 LLM 약점은 TableBench(AAAI 2025)·StatQA(NeurIPS 2024), 수치 주장 사실 확인은 QuanTemp(SIGIR 2024), 판정 보류는 Wen 외 서베이(TACL 2025)와 비교했다. 링크는 실험 결과 페이지의 ‘기존 연구와 무엇이 다른가’에 있다.

## 한계

- 소규모 실험(질문 120개, 자료 8종, 주 실험 모델 1종·비교 실험 답변 모델 3종(모두 OpenAI), A·C는 3회·나머지 1회)이라 통계적 유의성을 주장하지 않습니다.
- 한 문장에 숫자가 여러 개인 긴 답변에서 규칙 추출기가 범위를 잘못 연결하는 경우가 있습니다(비교 실험의 gpt-5-mini 답변에서 확인, 역추적이 ‘다른 범위의 값과 일치’로 표시).
- 모델의 실제 오답이 적어(본 세트 A 3건) 실제 답변 기준 재현율은 결론 내리지 않았습니다.
- 규칙 추출기는 문장에 열·기간이 드러나야 판정하므로 실제 답변에 대한 판정 비율이 실험·조건별 42~77%입니다. 일부 기간 범위(예: 2016~2020년), %p·인원 차이, 조건부 개수, 회귀·추세, 순위는 아직 보류합니다. 앞 문장에서 정한 대상(예: 도시)을 이어받는 문장도 보류합니다.
- 추출기는 실험 결과를 보며 고친 버전(v0.3, v0.5)이 있어, 각 수정 뒤 새로 만든 별도 검증 세트 결과를 함께 보고합니다.
- 단위는 사용자가 직접 확인해 입력하며 자동 추정하지 않습니다.

## 자료 출처

- NOAA NCEI Global Summary of the Month (시애틀 USW00024233, 2023)
- NOAA GML Mauna Loa monthly mean CO₂ (2024)
- World Bank WDI SP.POP.TOTL, SL.UEM.TOTL.ZS (대한민국, CC BY 4.0)
- NOAA NCEI GHCN-Daily (시애틀·로스앤젤레스·뉴욕·시카고 2023 일별, 0.1 단위 원자료를 10으로 나눔)
- World Bank WDI 2023 국가별 SP.POP.TOTL·SL.UEM.TOTL.ZS·NY.GDP.PCAP.CD·SP.DYN.LE00.IN (176개국, CC BY 4.0, 1인당GDP 2자리·실업률·기대수명 3자리 반올림)
- 숫자는 원본과 같고 열 이름만 한국어로 정리했습니다. 합성 예제는 실측 자료가 아닙니다.
