"""Generate a citation-to-local-artifacts technical portfolio case from actual JSON results.

Never substitutes fixture/example results and never runs inference. Missing sources are
explicitly marked unavailable; generated prose is stable and reproducible.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCES = {
    "ml": Path("ai_lab/out/results.json"),
    "safety": Path("ai_lab/out/reliability-results.json"),
    "stress": Path("ai_lab/out/stress/stress-results.json"),
    "scout": Path("ai_lab/out/scout/qwen-eval-results.json"),
    "trace": Path("ai_lab/out/trace/qwen-eval-results.json"),
}


def load_sources(root=ROOT):
    found = {}
    for name, path in SOURCES.items():
        candidate = root / path
        if candidate.is_file():
            found[name] = json.loads(candidate.read_text(encoding="utf-8"))
        else:
            found[name] = None
    return found


def render(sources):
    lines = [
        "# RescueOS — Engineering Case Study",
        "", "**AI Engineering | Machine Learning | Agent Reliability | Simulation**", "",
        "## Problema", "",
        "Como prever atrasos e investigar ocorrências de uma operação de delivery "
        "sem confundir conclusões do modelo com fatos verificados?",
        "", "## Arquitetura", "",
        "O restaurante 3D e seu simulador sintético geram pedidos e incidentes. O laboratório "
        "separa geração de dados, treino de ML, ferramentas de leitura, agentes Scout/Trace, "
        "validação canônica e avaliações offline/locais.",
        "", "- **Baseline:** regra operacional fixa comparada a regressão logística.",
        "- **Scout:** seleciona alertas existentes em um catálogo determinístico e verificável.",
        "- **Trace:** seleciona fatos e métricas de um pedido com referências aos eventos.",
        "- **Segurança:** o backend rejeita ferramentas, fatos e respostas incompatíveis com o snapshot.",
        "", "## Experimento A — Previsão de atraso (Stage 8A)", "",
    ]
    ml = sources.get("ml")
    if ml and "metrics" in ml and "counts" in ml:
        m = ml["metrics"]
        c = ml["counts"]
        lines += [
            f"- Entregas concluídas no treino: **{c['train_delivered']}**; no teste: **{c['test_delivered']}**.",
            f"- Pendentes excluídos do treino/teste: **{c['train_pending_excluded']} / {c['test_pending_excluded']}**.",
            "- Divisão dos dados: sementes inteiras separadas entre treino e teste.",
            "", "| Método | F1 de atraso | Recall de atraso | Balanced accuracy |", "|---|---:|---:|---:|",
        ]
        for key, name in (("fixed_rule", "Regra fixa"), ("logistic_regression", "Regressão logística")):
            v = m[key]
            lines.append(f"| {name} | {v['f1_late']:.3f} | {v['recall_late']:.3f} | {v['balanced_accuracy']:.3f} |")
        lines += ["", "**Limitação:** dados gerados pelo mesmo simulador; a seleção apenas de pedidos "
                  "concluídos introduz viés de sobrevivência. Comparar F1 agregado pode esconder falhas nos cenários raros.", ""]
        lines += ["| Cenário | Pedidos no teste | F1 do modelo |", "|---|---:|---:|"]
        for key, name in (("quiet", "Vazia"), ("medium", "Média"), ("busy", "Cheia")):
            if key in ml.get("per_scenario", {}):
                v = ml["per_scenario"][key]
                lines.append(f"| {name} | {v['examples']} | {v['model']['f1_late']:.3f} |")
        lines.append("")
    else:
        lines += ["**Dados ainda não encontrados:** execute o treino 8A para gerar `ai_lab/out/results.json`.", ""]
    lines += ["## Experimento B — Integridade e ataques (Stages 8B e 8D)", ""]
    for key, label in (("safety", "8B — Proteções offline"), ("stress", "8D — Matriz de estados offline")):
        data = sources.get(key)
        if data:
            c = data["counts"]
            total = c["total"]
            passed = c["passed"]
            bad = c.get("adversarial_total", 0)
            caught = c.get("rejected_adversarial", c.get("adversarial_rejected", 0))
            lines.append(f"- **{label}:** {passed}/{total} casos corretos; {caught}/{bad} rejeições adversariais adequadas.")
        else:
            lines.append(f"- **{label}:** resultados ainda não encontrados; execute a respectiva avaliação.")
    lines += ["", "**Interpretação:** resultados com provedor simulado provam propriedades testadas "
              "do pipeline, mas NÃO representam acurácia de modelo nem resistência em produção.",
              "", "## Experimento C — Inferência real local (Stage 8C)", "",
              "| Agente / caso | Concluiu | Critério estrito | Chamadas ao LLM | Duração |",
              "|---|---|---|---:|---:|"]
    for key, expected_case in (("scout", "scout_final"), ("trace", "trace_delayed")):
        data = sources.get(key)
        if data and data.get("mode") == "local-qwen3-4b-real-llm":
            records = [r for r in data["cases"] if r.get("case") == expected_case]
            if records:
                r = records[0]
                lines.append(f"| {key.capitalize()} / `{expected_case}` | {r['outcome']} | "
                             f"{'passou' if r.get('quality_pass') else 'falhou'} | {r['model_calls']} | "
                             f"{r['elapsed_ms']/1000:.1f}s |")
                continue
        lines.append(f"| {key.capitalize()} / `{expected_case}` | não disponível | — | — | — |")
    lines += ["", "**Limitação:** apenas um caso real por agente, ambos na mesma fixture histórica. "
              "Não são estimativas estatísticas de acurácia, nem medem a simulação viva.",
              "", "## Decisões de engenharia", "",
              "1. Não usar a saída textual do LLM como fonte de verdade: fatos e métricas vêm do snapshot.",
              "2. Separar testes com provedores simulados de testes com inferência real e latência medida.",
              "3. Segregar treino/teste por semente para evitar vazamento trivial entre noites.",
              "4. Documentar casos em que o modelo falha; não escolher somente exemplos positivos.",
              "", "## Limitações e próximos experimentos", "",
              "- Dataset sintético, sem validação em dados reais ou distribuição externa.",
              "- Uma única fixture histórica para Scout/Trace; precisamos de múltiplas operações independentes.",
              "- A avaliação atual do Trace prioriza cobertura dos fatos, não qualidade causal da explicação.",
              "- Próximos testes Qwen (manuais): Scout sem alertas, Trace sem atraso, e análise de falhas de schema.",
              "- Próximo estudo ML: sensibilidade a prevalência, calibração de probabilidades e tratamento dos pendentes.",
              "", "## Como reproduzir", "",
              "```powershell", ".\\.venv\\Scripts\\python.exe -B ai_lab\\reliability.py",
              ".\\.venv\\Scripts\\python.exe -B ai_lab\\stress_suite.py",
              ".\\.venv\\Scripts\\python.exe -B ai_lab\\case_study.py", "```", "",
              "Os comandos acima não executam inferência de LLM. Para inferência real, "
              "consultar `ai_lab/README_8C.md` e autorizar cada caso explicitamente.",
              "", "## Rastreabilidade de evidências", "",
    ]
    for key, path in SOURCES.items():
        lines.append(f"- **{key}:** `{path.as_posix()}` — {'encontrado' if sources.get(key) else 'ausente'}")
    lines.append("")
    return "\n".join(lines)


def main(argv=None):
    parser = argparse.ArgumentParser(description="Generate a portfolio case using ONLY local result JSON")
    parser.add_argument("--out", type=Path, default=ROOT / "ai_lab/out/AI_ENGINEERING_CASE.md")
    args = parser.parse_args(argv)
    report = render(load_sources())
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(report, encoding="utf-8")
    print("Case study:", args.out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
