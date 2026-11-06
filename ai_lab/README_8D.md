# Stage 8D — stress test e case técnico (offline)

Esta etapa usa o código real de Scout/Trace com **provedor controlado**. Não executa
Ollama, não altera frontend, agentes, contratos nem dados históricos.

## Instalação

Descompacte o ZIP na **raiz** de `D:\rescueos_starter`; acrescente somente os
arquivos da pasta `ai_lab`. Requer Stages 8B/8C instaladas.

## 1. Testes (offline, sem LLM)

```powershell
cd D:\rescueos_starter
.\.venv\Scripts\python.exe -B -m unittest discover -s ai_lab -p test_stage8d.py -v
```

## 2. Executar a matriz de robustez (offline)

```powershell
.\.venv\Scripts\python.exe -B ai_lab\stress_suite.py
```

Saídas: `ai_lab\out\stress\stress-report.md` e `stress-results.json`.

## 3. Gerar seu case técnico a partir dos resultados disponíveis

```powershell
.\.venv\Scripts\python.exe -B ai_lab\case_study.py
code ai_lab\out\AI_ENGINEERING_CASE.md
```

O gerador lê **somente** JSONs locais produzidos nas Stages anteriores. Se os
resultados estiverem ausentes, escreve “não disponível”; não inventa números.

## 4. Próximos DOIS testes reais (opcionais, um por vez)

A Stage 8C já possui dois casos novos que ainda não executamos: `scout_empty`
(quadro inicial sem alertas) e `trace_ontime` (pedido entregue no prazo).

**Não execute ambos de uma vez.** Primeiro, com Ollama ativo e HWiNFO aberto,
monitore a CPU e interrompa se alcançar o limite conservador de 85 °C.

```powershell
.\.venv\Scripts\python.exe -B ai_lab\eval_qwen.py --run-real --cases scout_empty --out ai_lab/out/scout-empty
```

Revise o resultado e as temperaturas **antes** de executar outro caso:

```powershell
.\.venv\Scripts\python.exe -B ai_lab\eval_qwen.py --run-real --cases trace_ontime --out ai_lab/out/trace-ontime
```

A Stage 8D **não** executa esses comandos automaticamente. Esses novos relatórios
são separados dos resultados anteriores e não são tratados como amostra estatística
suficiente para estimar acurácia geral. Eles ajudam a revelar falsos positivos e
respostas excessivas em casos negativos.

## Limites científicos

- 27 casos offline = 20 estados/combinações limpas + 7 ataques controlados.
- Todos os estados vêm da **mesma fixture histórica**. Isso **não** equivale a
  20 restaurantes ou operações independentes.
- Os ataques do 8D parcialmente sobrepõem os do 8B; não some 15 + 7 e anuncie
  22 técnicas de ataque diferentes.
- Tempos offline de stub não representam latência de inferência real.
- Dataset e métricas 8A são sintéticos; pedidos pendentes excluídos introduzem
  viés e o F1 varia fortemente com o cenário.
- A qualidade da explicação causal ainda não é medida automaticamente.
