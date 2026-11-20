# WHEN2WARN StatGuard 통합 개발 시작

현재 milestone은 **STATGUARD_OFFLINE_CORE_V0.1**이다. 기존 WHEN2WARN의 계정·대화·GPT·웹 근거·Agent 기능을 보존하고, 통계 검증용 별도 모듈을 추가했다. 이전 README와 연구·평가 자료는 당시 상태의 기록으로 보존한다.

## 이번 단계에서 구현한 것

- CSV bytes 입력 adapter: UTF-8/BOM·CP949, 열·행·셀·크기 제한, 중복 header와 행 폭 검증.
- 독립 계산 core: 합계·평균·명시적 분자/분모 비율·증감률·그룹 집계·동률 dense rank의 6종 연산 계열.
- 계산 근거: 데이터 버전, 계산 사양·식, 사용·제외·누락 행, 명시된 단위 연결.
- 수동으로 계산에 연결한 수치 주장 비교: 명시적 허용오차 내 일치·불일치, 연결·단위 불명 시 근거 부족.
- 구현 전에 고정한 24개 합성 개발 사례와 경계 조건 테스트.
- 외부 호출 없이 실행하는 한국어 읽기용 결과와 JSON demo.

이 모듈은 질문을 이해하거나 GPT 답변에서 주장을 자동 추출하지 않는다. 계산 사양과 단위를 호출자가 명시해야 한다. 함수 호출만으로 표의 의미나 단위의 사실성을 검증한 것은 아니다.

## 실행

프로젝트 루트에서 기존 Python을 사용한다. 새 패키지 설치나 API 키는 필요하지 않다.

```powershell
$env:PYTHONPATH=(Resolve-Path .\src).Path
python -B -m when2warn.statguard demo
python -B -m unittest discover -s tests -p test_statguard_offline_v0_1.py -v
```

읽기 쉬운 결과 파일을 새 폴더에 만들려면 다음처럼 실행한다. 이미 존재하는 결과 폴더는 거부한다.

```powershell
python -B -m when2warn.statguard demo --output-dir outputs\statguard_demo_new_run
```

저장된 이번 실행은 `artifacts/statguard_offline_core_v0.1/development_run_01/`에 있다. `demo_readable_ko.md`가 한국어 요약이며 JSON에는 계산 근거가 포함된다. 이것은 기존 evaluator 저장 adapter의 사용·검증이 아니다. 새 demo 결과 두 파일의 원자적 동시 commit을 보장하지 않는다.

## 예시

합성 CSV에서 A지역 방문자는 2023년 1,000명, 2024년 1,178명이다.

```text
(1178 - 1000) / 1000 * 100 = 17.8%

수동 연결한 합성 주장 23.0% → CONTRADICTED
수동 연결한 합성 주장 17.8% → VERIFIED_WITHIN_SCOPE
데이터·계산 연결이나 단위가 다름 → INSUFFICIENT_EVIDENCE
```

`VERIFIED_WITHIN_SCOPE`는 지정한 데이터·계산 조건·단위·허용오차 안의 일치다. 전체 답변의 진실이나 인과관계를 보장하지 않는다. 현재 비교기는 scalar 수치만 다루며 그룹·순위 주장과 의미 해석 자동 검증은 후속 범위다.

## 아직 구현·연결하지 않은 것

CSV 업로드 화면·웹 API·사용자별 데이터 보관·DB migration·GPT 데이터 분석/주장 추출·기존 대화 화면 통합·고급 통계검정·calibration·임의 Python 실행·새 모델 학습·배포는 포함하지 않는다. 기존 GPT 연결은 향후 재사용할 기반이며 이번 모듈에서 호출하지 않는다.

## 다음 한 단계

**사용자가 열·단위·계산 조건을 확인할 수 있는 CSV 입력·미리보기 흐름을 기존 인증·대화 경계에 연결한다.** 먼저 데이터 보관·삭제·외부 모델 전달 범위를 정하고, 계산 core의 검사와 거부 상태를 유지한다. GPT 자연어 연결은 명시적 계산 사양이 안정된 뒤 추가한다.

## 연구 상태와 보존

24개 사례는 합성 개발 fixture다. 독립 연구 test set, 실사용 정확도, 기존 모델의 개선 결과가 아니다. 기존 Agent·웹 검증 결과를 통계 검증 결과로 옮기지 않는다. 기존 v0.7 RED/2-of-8, 03 원인 미확정, evaluator REVISE/HOLD는 그대로다.

자세한 계산 정책과 한계는 [계산 계약](statguard_offline_contract_v0.1.md)에 있다. 이번 승인으로 향후 유료 호출이나 production 배포를 자동 수행하지 않는다.
