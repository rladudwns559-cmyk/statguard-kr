"""Build results/REPORT.md and the website data file for the large-table benchmark (v0.2)."""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
R = HERE / "results"
FRONT = HERE.parents[1] / "frontend" / "src" / "statguard" / "benchmarkSummaryLarge.json"
main = json.loads((R / "summary.json").read_text(encoding="utf-8"))
questions = {q["id"]: q for q in json.loads((HERE / "questions.json").read_text(encoding="utf-8"))}
expected = json.loads((HERE / "expected.json").read_text(encoding="utf-8"))

pct = lambda v: "—" if v is None else f"{v * 100:.1f}%"
num = lambda v: "—" if v is None else f"{v:.2f}"
NAMES = {"rule_v0.4": "규칙 v0.4(통계 포함, 실행 전 고정)", "rule_v0.5": "규칙 v0.5(본 세트 답변을 본 뒤 수정)", "llm": "LLM 추출 v0.2(gpt-6-luna)"}
COND = {"A": "A 일반 LLM", "B": "B LLM+자료 설명", "C": "C LLM+계산 도구"}

wrong = []
for qid, per in main["per_question"].items():
    for c, r in per.items():
        if not r["correct"]:
            e = expected[qid]
            wrong.append({"id": qid, "condition": c, "question": questions[qid]["question"], "category": questions[qid]["category"],
                          "final": r["final"], "expected": f"{e.get('value', '판단불가')} {e.get('unit', '')}".strip(), "kind": r["error_kind"],
                          "decisions": {k: r[k] for k in ("rule_v0.4", "rule_v0.5", "llm") if k in r}})
web = {k: v for k, v in main.items() if k != "per_question"}
web["wrong_answers"] = wrong
hold_path = R / "summary_holdout.json"
hold = json.loads(hold_path.read_text(encoding="utf-8")) if hold_path.exists() else None
if hold:
    web["holdout"] = {"meta": hold["meta"], "accuracy": hold["conditions"]["A"]["accuracy"]["all"], "statguard": hold["statguard"]}
FRONT.write_text(json.dumps(web, ensure_ascii=False, indent=1, default=str), encoding="utf-8")

m = main["meta"]
L = ["# StatGuard-KR 큰 표 벤치마크 결과 v0.2", "", f"생성 {m['generated']} · 조건은 PROTOCOL.md(실행 전 고정)를 따른다.", "",
     f"- 질문 {m['questions']}개(답변 가능 {m['answerable']} · 불가 {m['unanswerable']}), 자료 {m['datasets']}종(365행·1,460행)",
     f"- 모델 {main['usage']['model']} · 호출 {main['usage']['calls']}회 · 토큰 입력 {main['usage']['input_tokens']:,} / 출력 {main['usage']['output_tokens']:,} · 추정 ${main['usage']['estimated_usd']:.4f}", "",
     "## 1. 조건별 정답률", "", "| 조건 | 전체 | 답변 가능 | 답변 불가 | 오답 유형 |", "|---|---|---|---|---|"]
for c, v in main["conditions"].items():
    a = v["accuracy"]
    L.append(f"| {COND[c]} | {a['all']['correct']}/{a['all']['n']} ({pct(a['all']['rate'])}) | {a['answerable']['correct']}/{a['answerable']['n']} | {a['unanswerable']['correct']}/{a['unanswerable']['n']} | {', '.join(f'{k} {n}' for k, n in v['error_kinds'].items()) or '없음'} |")
L += ["", "### 오답 목록", "", "| 문항 | 조건 | 답변 | 기대값 | 유형 | StatGuard |", "|---|---|---|---|---|---|"]
for w in wrong:
    L.append(f"| {w['id']} {w['question']} | {w['condition']} | {w['final']} | {w['expected']} | {w['kind']} | {', '.join(f'{NAMES[k]} {d}' for k, d in w['decisions'].items())} |")
L += ["", "## 2. 실제 LLM 답변에 대한 StatGuard 판정", "", "| 조건 · 추출 | 판정 비율 | FLAG/PASS/HOLD | 정밀도 | 재현율 | 원래 오답률 → 통과 답변 오답률 | 보류 중 오답 | 단정 통과 |", "|---|---|---|---|---|---|---|---|"]
for k, v in main["statguard"].items():
    c, e = k.split("/")
    d = v["decisions"]
    L.append(f"| {c} · {NAMES[e]} | {pct(v['coverage'])} ({v['decided']}/{v['n']}) | {d.get('FLAG', 0)}/{d.get('PASS', 0)}/{d.get('HOLD', 0)} | {num(v['precision'])} | {num(v['recall'])} | {pct(v['raw_error_rate'])} → {pct(v['error_rate_among_passed'])} | {v['missed_errors_on_hold']} | {v['unanswerable_asserted_passed']}/{v['unanswerable_asserted']} |")
if "perturbation" in main:
    L += ["", "## 3. 오류 주입 세트", "", "| 추출 | 판정 비율 | 정밀도 | 재현율 | F1 | 유형별 FLAG/PASS/HOLD |", "|---|---|---|---|---|---|"]
    for k, v in main["perturbation"].items():
        L.append(f"| {NAMES[k]} | {pct(v['coverage'])} ({v['decided']}/{v['n']}) | {num(v['precision'])} | {num(v['recall'])} | {num(v['f1'])} | " +
                 " · ".join(f"{kind} {d.get('FLAG', 0)}/{d.get('PASS', 0)}/{d.get('HOLD', 0)}" for kind, d in v["by_kind"].items()) + " |")
if hold:
    h = hold["conditions"]["A"]["accuracy"]["all"]
    L += ["", "## 4. 별도 검증 세트 (v0.5 고정 후 새로 작성, A 조건)", "", f"A 정답 {h['correct']}/{h['n']} ({pct(h['rate'])}). 오답 유형: " + (", ".join(f"{k} {n}" for k, n in hold["conditions"]["A"]["error_kinds"].items()) or "없음"), "",
          "| 추출 | 판정 비율 | FLAG/PASS/HOLD | 정밀도 | 재현율 | 원래 오답률 → 통과 답변 오답률 | 보류 중 오답 |", "|---|---|---|---|---|---|---|"]
    for k, v in hold["statguard"].items():
        d = v["decisions"]
        L.append(f"| {NAMES[k.split('/')[1]]} | {pct(v['coverage'])} ({v['decided']}/{v['n']}) | {d.get('FLAG', 0)}/{d.get('PASS', 0)}/{d.get('HOLD', 0)} | {num(v['precision'])} | {num(v['recall'])} | {pct(v['raw_error_rate'])} → {pct(v['error_rate_among_passed'])} | {v['missed_errors_on_hold']} |")
L += ["", "## 5. 해석", "",
      "- 행이 많아지자 일반 LLM의 정답률이 크게 떨어졌다(작은 표 v0.1 A 33/36 → 큰 표 A 20/30, B 18/30). 365행 합계(888.4 vs 888.9mm), 표준편차·상관계수·t 통계량에서 수치 오류가 났고, 1,460행 표에서는 출력 한도에 걸려 답을 끝내지 못한 경우가 A·B 각 3건 있었다.",
      "- 계산 도구를 쓴 C는 29/30으로 오류가 거의 없었다(남은 1건은 조건부 개수를 도구가 지원하지 않아 판단불가로 답한 경우). 실행 기반 계산이 수치 오류를 줄인다는 RQ2와 일치한다.",
      "- StatGuard가 ‘통과’시킨 답변 중 오답은 모든 조건·추출 방식에서 0건이었다(A 원래 오답률 33.3% → 통과 답변 0%). 대신 판정 비율은 53~70%이며, 숫자가 없는 미완성 답변 등은 보류됐다.",
      "- 실행 전에 고정한 규칙 v0.4는 A에서 오류 표시 6건 중 2건이 오탐(조건부 개수 문장, 앞 문장의 도시를 이어받는 문장)이었다. 이를 고친 v0.5는 수정 후 새로 만든 별도 검증 세트에서도 오탐 0건(정밀도 1.00, v0.4는 0.33)이었다.",
      "- LLM 추출기는 본 세트에서 정밀도·재현율 1.00이었지만 별도 검증 세트에서는 오류 표시 4건 중 2건이 오탐(정밀도 0.50)이었다. 규칙 추출이 판정 범위는 좁지만 더 보수적이다.",
      "- 오류 주입 세트에서는 규칙 v0.4·v0.5·LLM 추출 모두 정밀도·재현율 1.00(판정 비율 71~87%)이었다.",
      "", "## 6. 한계", "", "- 기상 한 도메인, 본 30 + 검증 14문항, 모델 1종·질문당 1회. 통계적 유의성 주장 없음.",
      "- v0.5는 본 세트 답변을 보고 고쳤으므로 본 세트 수치는 낙관적이며, 별도 검증 세트(14문항)가 더 공정한 근거다.",
      "- 출력 한도로 끝나지 않은 답변은 형식 오류로 채점했다(재시도 없음)."]
(R / "REPORT.md").write_text("\n".join(L) + "\n", encoding="utf-8")
print("\n".join(L))
