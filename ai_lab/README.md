# RescueOS — AI Lab 8A (primeiro experimento de AI Engineering)

**Objetivo:** prever, na criação de um pedido, se ele será entregue após o prazo usando dados sintéticos gerados pelo **mesmo motor TypeScript da simulação viva**. Não altera o frontend, nenhum contrato de agente e não usa Ollama.

## Pré-requisitos

- Stage 7G ou 7H instalada (o exportador precisa de `routeKm`, `scenario`, `courierDueAt`, `LAST_ORDER_MINUTE`).
- Node 22+ com `--experimental-strip-types` (o exportador importa TypeScript diretamente).
- Python 3.11+ e `scikit-learn`/`joblib` (não precisa de GPU).

No PowerShell, a partir de `D:\rescueos_starter`:

```powershell
node --experimental-strip-types ai_lab/export_nights.mjs --seeds 150 --out ai_lab/data/delivery_risk.jsonl
uv run --python 3.14 --with scikit-learn --with joblib python ai_lab/train.py
uv run --python 3.14 --with scikit-learn --with joblib python -m unittest discover -s ai_lab -p test_lab.py -v
```

Sem `uv`: ative sua venv, rode `python -m pip install -r ai_lab/requirements.txt` e depois `python ai_lab/train.py` / `python -m unittest discover -s ai_lab -p test_lab.py -v`.

**Arquivos gerados:** `ai_lab/data/delivery_risk.jsonl`, `ai_lab/out/report.md`, `ai_lab/out/results.json`, `ai_lab/out/delivery_risk_logreg.joblib` (artefato treinado localmente; carregue apenas artefatos de origem confiável).

## Como evitar autoengano

1. Cada semente é inteiramente reservada a treino ou teste, **inclusive entre cenários**. Nunca separar pedidos aleatoriamente.
2. `features` incluem apenas o que o sistema sabe no instante de criação. O resultado final é armazenado exclusivamente no alvo `label_late`, fora de `features`.
3. Pedidos não entregues ao fim do turno são **pendentes** e **não são classificados como no prazo**. São excluídos e contados em separado (viés de sobrevivência).
4. Compare 3 abordagens: maioria, regra fixa e regressão logística. Não afirme melhoria se não houver.
5. O benchmark **não** valida desempenho em dados reais. O output é uma prova de método de ML, experimentação e engenharia com dados sintéticos.
6. Comportamentos dos monstrinhos são regras; isso não implica um LLM rodando automaticamente.

## Próximo passo

Stage 8B: benchmark adversarial do Scout/Trace com verificador de evidências e comparação de modelos em casos verdadeiros/ausentes/adulterados. Não executar Ollama sem consentimento explícito e monitoramento térmico.
