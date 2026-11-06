# Stage 8C — avaliação REAL do Qwen3:4B local

Esta etapa NÃO treina nem faz fine-tuning do modelo. Avalia se o Qwen3:4B, executando os **agentes reais Scout e Trace**, consegue selecionar fatos e alertas canônicos da fixture histórica sintética.

## Segurança / escopo

- O comando padrão **não executa inferência**. Uma execução real exige `--run-real`.
- Apenas endpoint Ollama local `127.0.0.1:11434` e modelo já instalado `qwen3:4b`.
- Não altera o jogo, a simulação viva ou as provas históricas.
- **Abra HWiNFO antes**, monitore a CPU; se exceder o limite conservador de **85 °C**, interrompa com `Ctrl+C`.
- Faça primeiro **um caso**, revise temperatura e latência, só então rode o segundo.
- 1 caso pode exigir mais de uma chamada ao modelo. Cada execução pode levar até 120 segundos (timeout do agente), além de carregamento inicial.
- Não execute a mesma bateria repetidamente só para obter um resultado melhor.

## Instalação

Descompacte o ZIP na raiz de `D:\rescueos_starter`, preservando `ai_lab` existente.

## 1. Testes offline (NÃO rodam Ollama)

```powershell
cd D:\rescueos_starter
.\.venv\Scripts\python.exe -B -m unittest discover -s ai_lab -p test_eval_qwen.py -v
```

## 2. Checagem sem inferência

```powershell
.\.venv\Scripts\python.exe -B ai_lab\eval_qwen.py
```

## 3. Uma inferência real, autorizada manualmente

Abra o Ollama (`ollama serve`) se ainda não estiver ativo. Com HWiNFO aberto:

```powershell
.\.venv\Scripts\python.exe -B ai_lab\eval_qwen.py --run-real --cases scout_final
```

Revise o arquivo `ai_lab\out\qwen-eval-report.md` e a temperatura. Depois, se tudo estiver estável, faça o segundo com um **diretório separado de resultados**:

```powershell
.\.venv\Scripts\python.exe -B ai_lab\eval_qwen.py --run-real --cases trace_delayed --out ai_lab/out/trace
```

O primeiro relatório fica em `ai_lab/out`, o segundo em `ai_lab/out/trace`. **Não precisa repetir o primeiro caso.**

## O que os números significam

- Scout: `% de alertas canônicos destacados pelo modelo`. O agente já retorna o catálogo canônico; usar apenas esse catálogo para contar acertos seria enganoso.
- Trace: `% de métricas canônicas efetivamente selecionadas pelo modelo` e presença do fato sobre o estado do pedido.
- `completed` mede se o agente terminou o fluxo, **não** se a IA foi completa ou útil.
- Falhas de schema, ausência do modelo, respostas inventadas, timeout, etc. são registradas.
- Este é um **teste pequeno da fixture histórica**, não mede incidentes nas noites vivas, generalização, nem acurácia em produção.
