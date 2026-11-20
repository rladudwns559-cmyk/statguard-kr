"""Build results/REPORT.md and the website data file from summary.json + summary_holdout.json."""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
R = HERE / "results"
FRONT = HERE.parents[1] / "frontend" / "src" / "statguard" / "benchmarkSummary.json"
main = json.loads((R / "summary.json").read_text(encoding="utf-8"))
hold = json.loads((R / "summary_holdout.json").read_text(encoding="utf-8"))
questions = {q["id"]: q for q in json.loads((HERE / "questions.json").read_text(encoding="utf-8"))}

pct = lambda v: "—" if v is None else f"{v * 100:.1f}%"
num = lambda v: "—" if v is None else f"{v:.2f}"
NAMES = {"rule_v0.1": "규칙 v0.1(사전 고정)", "rule_v0.2": "규칙 v0.2(기간 범위 수정)", "rule_v0.3": "규칙 v0.3(오탐 분석 후 수정)", "rule_v0.4": "규칙 v0.4(통계 연산 추가)", "rule_v0.5": "규칙 v0.5(큰 표 답변 분석 후 수정)", "rule_v0.6": "규칙 v0.6", "rule_v0.7": "규칙 v0.7(웹 적용)", "llm": "LLM 추출(gpt-6-luna)"}
COND = {"A": "A 일반 LLM", "B": "B LLM+자료 설명", "C": "C LLM+계산 도구"}

wrong = []
for qid, per in main["per_question"].items():
    for c, r in per.items():
        if not r["correct"]:
            wrong.append({"id": qid, "condition": c, "question": questions[qid]["question"], "final": r["final"], "kind": r["error_kind"],
                          "decisions": {k: r[k] for k in ("rule_v0.1", "rule_v0.2", "rule_v0.3", "rule_v0.4", "rule_v0.5", "rule_v0.6", "rule_v0.7", "llm") if k in r}})

web = {k: v for k, v in main.items() if k != "per_question"}
web["wrong_answers"] = wrong
web["holdout"] = {"meta": hold["meta"], "accuracy": hold["conditions"]["A"]["accuracy"]["all"], "statguard": hold["statguard"],
                  "usage_note": "별도 검증 세트 호출은 전체 사용량에 포함"}
FRONT.write_text(json.dumps(web, ensure_ascii=False, indent=1, default=str), encoding="utf-8")

L = ["# StatGuard-KR 벤치마크 결과 v0.1", "", f"생성 {main['meta']['generated']} · 조건은 PROTOCOL.md(실행 전 고정, 6-1·6-2 조정 기록 포함)를 따른다.", "",
     f"- 본 세트: 질문 {main['meta']['questions']}개(답변 가능 {main['meta']['answerable']} · 불가 {main['meta']['unanswerable']}), 자료 {main['meta']['datasets']}종",
     f"- 별도 검증 세트: 질문 {hold['meta']['questions']}개(A 조건만)",
     f"- 모델 {main['usage']['model']} · 호출 {main['usage']['calls']}회 · 토큰 입력 {main['usage']['input_tokens']:,} / 출력 {main['usage']['output_tokens']:,} · 추정 ${main['usage']['estimated_usd']:.4f} ({main['usage']['price_basis']})", "",
     "## 1. 조건별 정답률 (RQ1)", "", "| 조건 | 전체 | 답변 가능 | 답변 불가 | 오답 유형 |", "|---|---|---|---|---|"]
for c, v in main["conditions"].items():
    a = v["accuracy"]
    L.append(f"| {COND[c]} | {a['all']['correct']}/{a['all']['n']} ({pct(a['all']['rate'])}) | {a['answerable']['correct']}/{a['answerable']['n']} | {a['unanswerable']['correct']}/{a['unanswerable']['n']} | {', '.join(f'{k} {n}' for k, n in v['error_kinds'].items()) or '없음'} |")
h = hold["conditions"]["A"]["accuracy"]["all"]
L += ["", f"별도 검증 세트 A: {h['correct']}/{h['n']} ({pct(h['rate'])}).", "", "### 오답 목록", "", "| 문항 | 조건 | 최종값 | 유형 | StatGuard 판정 |", "|---|---|---|---|---|"]
for w in wrong:
    L.append(f"| {w['id']} {w['question']} | {w['condition']} | {w['final']} | {w['kind']} | {', '.join(f'{NAMES[k]} {d}' for k, d in w['decisions'].items())} |")
L += ["", "## 2. 실제 LLM 답변에 대한 StatGuard 판정 (RQ2·RQ3)", "", "FLAG=오류 표시, PASS=통과, HOLD=보류. 정밀도·재현율은 FLAG/PASS로 결정한 답변만 사용.", "",
      "| 세트 · 조건 · 추출 | 판정 비율 | FLAG/PASS/HOLD | 정밀도 | 재현율 | 원래 오답률 → 통과 답변 오답률 | 단정 통과 |", "|---|---|---|---|---|---|---|"]
for label, s in (("본", main), ("검증", hold)):
    for k, v in s["statguard"].items():
        c, e = k.split("/")
        d = v["decisions"]
        L.append(f"| {label} · {c} · {NAMES[e]} | {pct(v['coverage'])} ({v['decided']}/{v['n']}) | {d.get('FLAG', 0)}/{d.get('PASS', 0)}/{d.get('HOLD', 0)} | {num(v['precision'])} | {num(v['recall'])} | {pct(v['raw_error_rate'])} → {pct(v['error_rate_among_passed'])} | {v['unanswerable_asserted_passed']}/{v['unanswerable_asserted']} |")
L += ["", "## 3. 오류 주입 세트", "", "| 추출 | 판정 비율 | 정밀도 | 재현율 | F1 | 유형별 FLAG/PASS/HOLD |", "|---|---|---|---|---|---|"]
for k, v in main["perturbation"].items():
    L.append(f"| {NAMES[k]} | {pct(v['coverage'])} ({v['decided']}/{v['n']}) | {num(v['precision'])} | {num(v['recall'])} | {num(v['f1'])} | " +
             " · ".join(f"{kind} {d.get('FLAG', 0)}/{d.get('PASS', 0)}/{d.get('HOLD', 0)}" for kind, d in v["by_kind"].items()) + " |")
L += ["", "## 4. 해석", "",
      "- gpt-6-luna는 작은 표(2~12행)의 단순 연산에서 이미 정답률이 높았다(A 본 세트 33/36, 별도 세트 18/18). 그래서 실제 답변에서 잡을 오류 자체가 적었고(본 세트 A 3건), 실제 답변 기준 재현율은 표본이 너무 작아 결론을 내리지 않는다.",
      "- 계산 도구를 쓴 C 조건은 36/36으로, 실행 기반 계산이 수치 오류를 없애는 방향과 일치한다(RQ2). 다만 A와 차이는 3문항이다.",
      "- 오류를 알고 넣은 문장에서는 규칙 v0.2·v0.3과 LLM 추출기 모두 정밀도 1.00, 재현율 0.97~1.00으로 오류를 표시했다. LLM 추출기는 판정 비율이 더 높고(98%) 증감률 기준을 뒤바꾼 문장 1건을 통과시켰다.",
      "- 규칙 v0.1은 실제 정답 답변 4건(A)에 오류 표시를 냈다(기간 범위·% 열 혼동). v0.3은 본 세트와 별도 검증 세트에서 오탐 0건이지만, 본 세트는 수정에 사용했으므로 별도 검증 세트(오탐 0, 판정 비율 10/18)가 더 공정한 근거다.",
      "- 규칙 추출기는 문장에 열·기간이 드러나지 않으면 보류해 판정 비율이 40~60%에 머문다. 판정 비율과 오탐 사이의 균형이 주요 한계다.",
      "- 답변 불가 질문에 모델이 단정한 답변(본 세트 A 1건, C06 회귀분석 p값)을 StatGuard는 어떤 추출기로도 통과시키지 않았다(보류).",
      "", "## 5. 한계", "", "- 소규모(본 36 + 검증 18문항, 자료 5종)이며 통계적 유의성을 주장하지 않는다.",
      "- 모델 1종, 질문당 1회 실행. 다른 모델·반복 실행에서 결과가 달라질 수 있다.",
      "- 정답 판정의 단위 비교는 엄격하다(예: K02 A는 수치는 맞지만 '% %' 표기로 단위 오류 처리).",
      "- 계산 일치는 연결된 계산만 확인하며 답변 전체의 사실·인과를 보증하지 않는다."]
(R / "REPORT.md").write_text("\n".join(L) + "\n", encoding="utf-8")
print("\n".join(L))
