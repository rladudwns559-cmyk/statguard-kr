"""Package the benchmark as a public dataset for download from the website (no API calls).

python -X utf8 -I export_dataset.py  → frontend/public/statguard-dataset/
  README.md                 dataset card (composition, sources, licenses, limits)
  questions.jsonl           120 questions with the expected value, unit and the calculation that defines it
  answers_gpt-6-luna_A.jsonl the plain-LLM answer to each question + correctness + StatGuard verdict + correction outcome
  tables/*.csv              the 8 tables (numbers unchanged from the sources; Korean column names)
"""
from __future__ import annotations

import hashlib
import json
import shutil
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE.parent / "frontend/public/statguard-dataset"
BENCH = [("v0.1", "statguard_benchmark_v0.1"), ("v0.2", "statguard_benchmark_v0.2"), ("v0.3", "statguard_benchmark_v0.3")]


def main():
    if OUT.exists():
        shutil.rmtree(OUT)
    (OUT / "tables").mkdir(parents=True)
    answers = {i["key"]: i for i in json.loads((HERE.parent / "frontend/src/statguard/aiAnswers.json").read_text(encoding="utf-8"))["items"]}
    qrows, arows, tables = [], [], {}
    for bench, folder in BENCH:
        base = HERE / folder
        datasets = json.loads((base / "datasets.json").read_text(encoding="utf-8"))
        for set_ in ("", "_holdout"):
            qp = base / f"questions{set_}.json"
            if not qp.exists():
                continue
            expected = json.loads((base / f"expected{set_}.json").read_text(encoding="utf-8"))
            for q in json.loads(qp.read_text(encoding="utf-8")):
                ds = datasets[q["dataset"]]
                tables[ds["file"]] = base / "datasets" / ds["file"]
                key = f"{bench}{set_}:{q['id']}"
                e = expected[q["id"]]
                qrows.append({"id": key, "benchmark": bench, "split": "holdout" if set_ else "main", "table": "tables/" + ds["file"],
                              "domain": ds.get("domain"), "category": q.get("category"), "question": q["question"],
                              "answerable": e["answerable"], "expected_value": e.get("value"), "unit": e.get("unit"),
                              "statguard_supported": e.get("statguard_supported"), "calculation": q.get("calc")})
                a = answers[key]
                arows.append({"id": key, "model": "gpt-6-luna", "condition": "A (CSV + 질문, 도구 없음)", "answer": a["answer"],
                              "final_value": a["final"], "correct": a["correct"], "error_kind": a["error_kind"] or None,
                              "statguard_rule_v0_7": a["statguard"], "statguard_flag": a["flag"],
                              "corrected_with_evidence_round": a["corrected_round"], "fixed_by_plain_recheck": a["recheck_fixed"]})
    for name, src in tables.items():
        shutil.copyfile(src, OUT / "tables" / name)
    (OUT / "questions.jsonl").write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in qrows) + "\n", encoding="utf-8")
    (OUT / "answers_gpt-6-luna_A.jsonl").write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in arows) + "\n", encoding="utf-8")
    files = sorted(p for p in OUT.rglob("*") if p.is_file())
    sums = "\n".join(f"| `{p.relative_to(OUT).as_posix()}` | {p.stat().st_size:,} B | `{hashlib.sha256(p.read_bytes()).hexdigest()[:16]}…` |" for p in files)
    wrong = sum(not r["correct"] for r in arows)
    card = f"""# StatGuard-KR 한국어 수치 주장 벤치마크 v0.1

LLM이 표(CSV)를 보고 쓴 한국어 답변의 **수치 주장**을 검증하는 연구용 데이터셋입니다. 2026 하반기 SW·AI 융합연구개발 일반과제 StatGuard-KR에서 만들었습니다.

## 구성

- 질문 {len(qrows)}개(본 세트 {sum(r['split'] == 'main' for r in qrows)} · 별도 검증 세트 {sum(r['split'] == 'holdout' for r in qrows)}), 표 {len(tables)}종, 답변 불가 질문 {sum(not r['answerable'] for r in qrows)}개 포함
- 각 질문의 기대값은 모델 답변이 아니라 계산 엔진과 별도의 분수(Fraction) 계산으로 만들었고, 그 계산 정의를 `calculation`에 담았습니다.
- `answers_gpt-6-luna_A.jsonl`: gpt-6-luna가 CSV와 질문만 보고 쓴 답변(조건 A, 1회차). 오답 {wrong}개. 각 답변에 StatGuard(규칙 v0.7) 판정과, 재계산 근거를 돌려줬을 때 고쳐졌는지(근거 교정)·단순 재확인으로 고쳐졌는지를 함께 기록했습니다.

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

- 모델 1종, 소규모(질문 {len(qrows)}개). 일반화된 성능 순위로 쓰지 마세요.
- 모델 답변은 같은 질문에도 매번 달라질 수 있습니다(반복 실행 결과는 저장소의 experiments/STABILITY.md).

## 파일

| 파일 | 크기 | SHA-256 앞부분 |
|---|---|---|
{sums}
"""
    (OUT / "README.md").write_text(card, encoding="utf-8")
    print("questions", len(qrows), "answers", len(arows), "tables", len(tables), "wrong", wrong, "files", len(files) + 1)


if __name__ == "__main__":
    main()
