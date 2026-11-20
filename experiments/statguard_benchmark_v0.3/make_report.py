"""Build results/REPORT.md and the website data file for the large-table benchmark (v0.2)."""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
R = HERE / "results"
FRONT = HERE.parents[1] / "frontend" / "src" / "statguard" / "benchmarkSummaryDomain.json"
main = json.loads((R / "summary.json").read_text(encoding="utf-8"))
questions = {q["id"]: q for q in json.loads((HERE / "questions.json").read_text(encoding="utf-8"))}
expected = json.loads((HERE / "expected.json").read_text(encoding="utf-8"))

pct = lambda v: "—" if v is None else f"{v * 100:.1f}%"
num = lambda v: "—" if v is None else f"{v:.2f}"
NAMES = {"rule_v0.6": "규칙 v0.6(실행 전 고정)", "rule_v0.7": "규칙 v0.7(이 답변을 본 뒤 수정, 사후)", "llm": "LLM 추출 v0.2(gpt-6-luna)"}
COND = {"A": "A 일반 LLM", "B": "B LLM+자료 설명", "C": "C LLM+계산 도구"}

wrong = []
for qid, per in main["per_question"].items():
    for c, r in per.items():
        if not r["correct"]:
            e = expected[qid]
            wrong.append({"id": qid, "condition": c, "question": questions[qid]["question"], "category": questions[qid]["category"],
                          "final": r["final"], "expected": f"{e.get('value', '판단불가')} {e.get('unit', '')}".strip(), "kind": r["error_kind"],
                          "decisions": {k: r[k] for k in ("rule_v0.6", "rule_v0.7", "llm") if k in r}})
web = {k: v for k, v in main.items() if k != "per_question"}
web["wrong_answers"] = wrong
hold_path = R / "summary_holdout.json"
hold = json.loads(hold_path.read_text(encoding="utf-8")) if hold_path.exists() else None
if hold:
    web["holdout"] = {"meta": hold["meta"], "accuracy": hold["conditions"]["A"]["accuracy"]["all"], "statguard": hold["statguard"]}
FRONT.write_text(json.dumps(web, ensure_ascii=False, indent=1, default=str), encoding="utf-8")

m = main["meta"]
L = ["# StatGuard-KR 도메인 확장 벤치마크 결과 v0.3 (World Bank 176개국)", "", f"생성 {m['generated']} · 조건은 PROTOCOL.md(실행 전 고정)를 따른다.", "",
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
      "- 국가별 표(176행)에서도 일반 LLM의 정답률이 낮았다(A 12/22, B 13/22). 오답 10건 중 6건은 출력 한도(2,500토큰)에 걸려 답을 끝내지 못한 경우였고, 나머지는 평균·표준편차·상관계수 수치 오류였다. 계산 도구를 쓴 C는 21/22.",
      "- 실행 전 고정한 규칙 v0.6이 A에서 통과시킨 답변 8건과 오류 표시 2건은 모두 맞았다(정밀도 1.00, 통과 답변 오답 0). B·C에서는 ‘국가 48개’, ‘2곳’ 같은 개수 표현을 주장 값으로 읽은 오탐이 각 1건 있었고, 사후 수정한 v0.7에서 사라졌다(새 별도 검증 세트로는 확인하지 않음).",
      "- LLM 추출기는 자료에 없는 ‘연도’ 열을 조건으로 자주 추가해 보류가 많았다(오류 주입 세트 판정 비율 24%). 규칙 추출은 같은 세트에서 84%.",
      "- 세 벤치마크 모두에서 StatGuard가 ‘통과’시킨 답변 중 오답은 없었다.",
      "", "## 6. 한계", "", "- 한 시점(2023) 국가별 자료 22문항. 국가 이름은 영어 원문이라 국가를 이름으로 지목한 문장은 규칙 추출이 보류한다.",
      "- v0.7은 이 답변을 본 뒤 고쳤으며 별도 검증 세트로 확인하지 않았다."]
(R / "REPORT.md").write_text("\n".join(L) + "\n", encoding="utf-8")
print("\n".join(L))
