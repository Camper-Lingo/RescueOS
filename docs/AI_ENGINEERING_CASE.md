# RescueOS — AI Engineering Case Study

**Machine learning · LLM agents · Tool integrity · Evaluation · Synthetic simulation**

> **Resumo:** Criei um restaurante 3D com uma operação de delivery sintética e reproduzível, e usei essa simulação como laboratório para prever atrasos e testar a confiabilidade de agentes de IA. O objetivo central é separar **inferências de modelos** de **fatos verificáveis**. Os experimentos abaixo são locais e sintéticos; não medem desempenho em operações reais do iFood.

## 1. O problema de engenharia

Um sistema de IA pode identificar um possível atraso e explicar um pedido, mas uma resposta convincente não é necessariamente correta. O RescueOS investiga duas perguntas:

1. **Previsão:** é possível prever atraso de entrega usando somente informações disponíveis no momento da previsão?
2. **Confiabilidade:** agentes com acesso a ferramentas conseguem selecionar fatos corretos sem transformar dados adulterados ou referências inventadas em conclusões?

## 2. Arquitetura e limites entre componentes

```text
Restaurante 3D / simulador sintético
          |
          +----> eventos + estados de pedidos ----> dataset por semente
          |                                           |
          |                                    baseline por regra
          |                                    regressão logística
          |                                           |
          |                                    avaliação ML (8A)
          |
Fixture histórica canônica ----> ferramentas read-only
                                         |
                                 Scout / Trace + Qwen3:4B
                                         |
                             validação independente de fatos,
                             referências e resultados de ferramentas
                                         |
                                avaliações offline e reais
                                     (8B, 8C, 8D)
```

**Scout** seleciona alertas já existentes em um catálogo verificável. **Trace** seleciona evidências e métricas associadas a pedidos. Nenhum deles pode tornar uma afirmação verdadeira apenas por escrevê-la: a validação confere as referências com o snapshot de origem.

**Distinção essencial:** o experimento de ML usa noites geradas pelo simulador vivo; a avaliação real de Scout/Trace abaixo usa **uma fixture histórica sintética**, não a operação viva. São duas superfícies de teste diferentes.

## 3. Experimento A — Predição de atraso (Stage 8A)

**Tarefa:** classificação binária de atraso para pedidos com entrega concluída.

- **Dados:** 6.270 pedidos sintéticos, gerados em 450 noites simuladas.
- **Treino / teste com rótulo conhecido:** 3.942 / 991 entregas concluídas.
- **Excluídos por não terem desfecho de entrega:** 1.083 / 254 pedidos pendentes.
- **Separação:** sementes de simulação inteiras, não divisão aleatória de linhas do mesmo cenário.
- **Modelos comparados:** regra operacional fixa e regressão logística; a classe positiva é **atraso**.

| Abordagem | Precision | Recall | F1 (atraso) | Balanced accuracy |
|---|---:|---:|---:|---:|
| Regra fixa | **0,735** | 0,665 | 0,698 | 0,791 |
| Regressão logística | 0,721 | **0,925** | **0,810** | **0,901** |

**Leitura:** a regressão logística ganhou **0,112 ponto de F1**, principalmente por identificar mais atrasos (*recall* maior), à custa de *precision* um pouco menor. Não basta declarar que um modelo é “melhor” sem explicitar esse trade-off.

| Cenário de teste | Pedidos com desfecho | Prevalência de atraso | F1 do ML |
|---|---:|---:|---:|
| Noite vazia | 233 | 2,6% | 0,545 |
| Noite média | 358 | 4,8% | **0,304** |
| Noite cheia | 400 | 57,8% | 0,860 |

**Falha relevante:** o F1 agregado esconde a dificuldade em noites médias, onde atrasos são raros. A avaliação precisa incluir prevalência, matriz de confusão por cenário, calibração e análise de falsos positivos; não apenas uma média geral.

**Limites:** os pedidos são sintéticos, produzidos pelo mesmo simulador; a divisão por semente reduz vazamento trivial, mas não prova ausência de vazamento por funcionalidades nem generalização externa. Excluir pendentes introduz **viés de seleção/sobrevivência**. Os números não estimam precisão em produção.

## 4. Experimento B — Integridade de ferramentas e respostas (Stages 8B e 8D)

O pipeline foi avaliado contra respostas controladas de provedor simulado, incluindo métricas adulteradas, referências inexistentes, ferramentas proibidas, estados inconsistentes e campos inesperados.

| Suíte | Casos que atenderam ao contrato | Casos adversariais rejeitados |
|---|---:|---:|
| 8B — Integridade dos agentes | 20/20 | 15/15 |
| 8D — Estados e robustez | 27/27 | 7/7 |

Exemplo: quando um resultado de ferramenta tenta substituir uma duração comprovada por **999 minutos**, a verificação compara o dado recebido com a fonte canônica, em vez de confiar na saída da ferramenta ou na resposta textual do LLM.

**O que foi demonstrado:** rejeição correta **dos casos testados** pelos validadores e contratos dos agentes. **O que não foi demonstrado:** taxa de acerto de modelo real, imunidade geral a ataques, segurança de produção ou cobertura de todas as falhas possíveis. As duas suítes não devem ser somadas como amostras estatisticamente independentes.

## 5. Experimento C — Qwen3:4B real via Ollama (Stage 8C)

Os testes seguintes realizaram inferência **real e local**, com duas chamadas ao modelo por caso. Todos usam o **mesmo snapshot histórico sintético** (SHA-256 abaixo).

| Agente | Caso | Status | Critério estrito do avaliador | Chamadas | Tempo real |
|---|---|---|---|---:|---:|
| Scout | `scout_final` (alertas presentes) | `completed` | passou | 2 | 17,8 s |
| Scout | `scout_empty` (sem alertas) | `completed` | passou | 2 | 10,4 s |
| Trace | `trace_delayed` (entrega atrasada) | `completed` | passou | 2 | 24,7 s |
| Trace | `trace_ontime` (entrega no prazo) | `completed` | passou | 2 | 18,9 s |

**Resultado: 4/4 casos concluídos e aprovados nos critérios estritos definidos.** Isso **não é 100% de acurácia estatística**. Em Scout, a avaliação considera as referências de alertas realmente selecionadas pelo modelo, e não só o catálogo que o backend já retorna. Em Trace, considera cobertura de referências/métricas e presença de estado; **não mede profundamente qualidade causal ou narrativa da explicação**.

As durações são medições locais observadas, não benchmarks de throughput ou latência em produção. Com apenas um caso por condição, não podemos inferir distribuição de erros, variância de tempo ou comportamento fora da fixture.

**Snapshot:** `7ecb72a85c690c845e4464fc791960ed6a5aeb3e1cbdd1106ffdabe4d8d4eaf6`.

## 6. Decisões e trade-offs de engenharia

- **Fatos antes da fluência:** respostas de modelos são hipóteses ou seleções; tempos, estados e fontes vêm de eventos canônicos.
- **Regras vs. ML vs. LLM:** usar a solução mais simples que cumpra o problema; medir *precision*, *recall*, custo e latência antes de justificar maior complexidade.
- **Controle experimental:** preservar sementes, snapshots e gabaritos para reproduzir cenários.
- **Separação de avaliações:** testes com stubs validam contratos; inferência real mede o modelo. Não trocar uma evidência pela outra.
- **Falhas visíveis:** reportar pior desempenho nas noites médias, exclusão de pendentes e amostra pequena de LLM, em vez de selecionar apenas resultados favoráveis.

## 7. Limitações e próximos experimentos

1. **Generalização:** gerar operações e famílias de incidentes realmente independentes; testar fora da distribuição e, quando autorizado, validar com dados não sintéticos.
2. **Qualidade das explicações:** construir rubrica humana/semiautomática para causalidade, menções sem fonte, abstenção e incerteza.
3. **ML:** calibrar probabilidades, medir falsos alarmes por cenário e modelar pendências sem tratá-las artificialmente como entregas no prazo ou atrasadas.
4. **Robustez de agentes:** testar esquemas inválidos e indisponibilidade de ferramentas com modelo real, medindo tanto rejeições seguras quanto perda de utilidade.
5. **Operação:** observar memória, CPU, variância de latência e custos sob repetição; nenhuma avaliação de produção foi realizada.

## 8. Como reproduzir

A partir da raiz do projeto, com dependências instaladas:

```powershell
# Dataset e modelo ML (usa scikit-learn via uv)
node --experimental-strip-types ai_lab/export_nights.mjs --seeds 150
uv run --python 3.14 --with scikit-learn --with joblib python ai_lab/train.py

# Validação offline do pipeline de agentes (não usa Ollama)
.\.venv\Scripts\python.exe -B ai_lab\reliability.py
.\.venv\Scripts\python.exe -B ai_lab\stress_suite.py

# Relatório consolidado automático
.\.venv\Scripts\python.exe -B ai_lab\case_study.py
```

**Inferência real:** os comandos abaixo são **opt-in**, executam Qwen3:4B no Ollama local e devem ser usados separadamente, observando a temperatura da CPU:

```powershell
.\.venv\Scripts\python.exe -B ai_lab\eval_qwen.py --run-real --cases scout_final --out ai_lab/out/scout
.\.venv\Scripts\python.exe -B ai_lab\eval_qwen.py --run-real --cases scout_empty --out ai_lab/out/scout-empty
.\.venv\Scripts\python.exe -B ai_lab\eval_qwen.py --run-real --cases trace_delayed --out ai_lab/out/trace
.\.venv\Scripts\python.exe -B ai_lab\eval_qwen.py --run-real --cases trace_ontime --out ai_lab/out/trace-ontime
```

Consulte `ai_lab/README_8C.md` para os requisitos e as instruções detalhadas. Executar os quatro casos é opcional e não é necessário para reproduzir as validações offline.

### Rastreabilidade das evidências

- `ai_lab/out/results.json` — métricas ML.
- `ai_lab/out/reliability-results.json` — testes offline 8B.
- `ai_lab/out/stress/stress-results.json` — testes offline 8D.
- `ai_lab/out/scout/qwen-eval-results.json` — Scout, alertas presentes.
- `ai_lab/out/scout-empty/qwen-eval-results.json` — Scout, sem alertas.
- `ai_lab/out/trace/qwen-eval-results.json` — Trace, atrasado.
- `ai_lab/out/trace-ontime/qwen-eval-results.json` — Trace, no prazo.

> **Publicação:** antes do commit, confirmar que cada caminho acima existe e que os resultados compartilhados não incluem dados privados, tokens ou logs sensíveis. Se arquivos em `out/` forem ignorados pelo Git, publicar apenas os relatórios sanitizados como artefatos de evidência, sem alterar as medições.
