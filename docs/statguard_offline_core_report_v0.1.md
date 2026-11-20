# StatGuard 통합 첫 구현 결과 v0.1

Milestone: STATGUARD_OFFLINE_CORE_V0.1

기존 WHEN2WARN에 별도 StatGuard 계산 모듈을 추가했다. 이번 완료 범위는 **CSV 읽기와 독립 계산 기반**이다. 웹 업로드나 GPT 기반 분석까지 완성한 상태는 아니다.

## 구현 결과

- `src/when2warn/statguard/`: 기존 Agent·웹 검증 core를 import하지 않는 별도 모듈.
- CSV adapter: UTF-8/BOM·CP949, 1 MiB·10,000행·64열·셀 512자 한계와 중복 header·행 폭·인코딩 검사.
- 6종 계열: 합계·평균·분자/분모 비율·증감률·그룹 sum/mean·dense rank.
- 숫자는 명시한 열에 한해 Decimal로 계산한다. 정수부 18자리·소수부 6자리, 산술 precision 34·ROUND_HALF_EVEN. 순환 소수는 이 계약에 따라 반올림되며 무한 정밀도를 주장하지 않는다.
- 기본 누락 거부, 명시적 omit만 허용, 사용·누락·제외 행과 단위·식·데이터/사양 연결을 근거로 제공.
- 수동 연결한 scalar 주장만 허용오차에 따라 비교. 연결·단위 불명은 근거 부족. 인과·통계 해석·그룹/순위 자연어 주장의 자동 판정은 미구현.

## 실제 합성 예시

A지역 방문자는 1,000명에서 1,178명으로 증가했다. `(1178 - 1000) / 1000 * 100 = 17.8%`다.

| 수동 연결한 합성 주장 | 계산값 | 결과 |
|---|---|---|
| 23.0% | 17.8% | CONTRADICTED |
| 17.8% | 17.8% | VERIFIED_WITHIN_SCOPE |

허용오차는 명시적으로 absolute 0.05 percentage point, relative 0을 사용했다. 이는 개발 예시의 고정 정책이며 평가 점수에 맞춘 threshold tuning이나 신뢰도 보정이 아니다. 단위 metadata는 호출자 주장이고 표의 실제 단위까지 검증하지 않는다.

## 테스트와 무결성

| 검사 | 실제 결과 |
|---|---|
| 구현 전 고정한 합성 사례 | 24/24 기대값 일치 |
| 최초 신규 단위 테스트 | 83 통과, 실패 0, 오류 0, skip 0 |
| import 독립성 검사 보완 후 staging 테스트 | 83 통과, 실패 0, 오류 0, skip 0 |
| 실제 프로젝트 설치 후 신규 테스트 | 83 통과, 실패 0, 오류 0, skip 0 |
| 기존 test_trajectory 회귀 | 2 통과, 실패 0, 오류 0, skip 0 |
| 기존 결과 폴더 거부 | exit 2, 이전 두 파일 해시 불변 |
| staging과 실제 프로젝트의 demo | JSON/Markdown SHA-256 각각 일치 |
| 기존 보호 파일 | 946/946 해시 불변 |
| 초기 설치 payload | 22/22 새 파일 해시 일치, 기존 덮어쓰기 0 |

테스트 숫자는 실행별로 분리하며 83개를 반복 실행한 횟수를 새로운 독립 테스트 건수로 합산하지 않는다. 24개는 고정 개발 fixture이며 독립 연구 test set이나 모집단 정확도가 아니다. 기대값은 명시적 상수로 기록했고 사례·계산 계약 해시는 core 구현 전에 고정했다.

socket·urlopen·subprocess 생성이 차단된 Python 테스트 환경에서 확인했다. 기존 전체 제품·DB·frontend·안전 evaluator 테스트를 재실행한 것은 아니다. 관련 없는 기존 20ms timeout 테스트도 변경하거나 새 통과로 세지 않았다.

## 보존과 경계

기존 소스·연구·평가를 수정하지 않고 새 파일만 추가했다. root README는 과거 연구 단계의 기록으로 남아 있으므로 새 시작점은 `docs/statguard_start_here_v0.1.md`다. 기존 v0.7 RED/2-of-8와 03 원인 미확정, evaluator REVISE/HOLD는 유지한다.

새 demo CLI는 synthetic/offline만 지원하며 live 모드가 없다. CLI 산출물 두 파일은 개발 결과이지 제품 업로드 저장소나 evaluator commit 검증이 아니다. 두 파일의 동시 원자적 저장·재시작 복구·디스크 장애 안전성을 이번에 보장한 것은 아니다.

```text
paid API calls = 0
external search/fetch = 0
API / DB / deployment changes = 0
model training runs = 0
past live set reruns = 0
real user data used = false
```

## 아직 남은 것

CSV 업로드·미리보기 UI/API, 사용자별 파일 보관·삭제 정책, 기존 대화와 데이터 연결, GPT 분석 입력과 수치 주장 추출, 자연어와 계산 조건 매핑, 그룹·순위 주장 검증, 독립 benchmark, 고급 통계검정과 보정은 후속 단계다. 기존 GPT 연결을 이번에 다시 호출하거나 production에서 켜지 않았다.

## 다음 최소 작업

사용자가 열·단위·계산 조건을 확인할 수 있는 CSV 입력·미리보기 흐름을 기존 인증·대화 경계에 연결한다. 데이터의 모델 전달·보존·삭제 범위를 먼저 정하고 기존 권한 체계를 재사용한다. 그다음에만 자연어 분석과 주장 추출을 붙인다.

실행 안내는 `statguard_start_here_v0.1.md`, 상세 계약은 `statguard_offline_contract_v0.1.md`, 읽기용 결과는 `artifacts/statguard_offline_core_v0.1/development_run_01/demo_readable_ko.md`를 참고한다.
