# RescueOS — Delivery Intelligence Control Tower

## Etapa 5A — The Living Restaurant

A Control Tower local está implementada para revisão independente: restaurante 3D
procedural, cinco mascotes originais, pedidos selecionáveis, replay temporal e
painel de evidências ligados a uma API FastAPI somente leitura. Todos os dados são
sintéticos; não há execução de agentes ou ações operacionais.

Com as dependências já instaladas e autorizadas, abra dois terminais PowerShell:

```powershell
# Terminal 1 — raiz do repositório
Set-Location D:\rescueos_starter
.\.venv\Scripts\python.exe -B -m uvicorn rescueos.tower.api:app --host 127.0.0.1 --port 8000
```

```powershell
# Terminal 2
Set-Location D:\rescueos_starter\frontend
npm.cmd run dev
```

Abra **http://127.0.0.1:5173/**. Selecione `ord-1002`, abra as evidências e use
reiniciar/reproduzir ou arraste a timeline. O primeiro carregamento mostra o
snapshot final pausado. `?view=2d` abre a alternativa acessível sem a cena 3D.
Use Ctrl+C em cada terminal para encerrar. Os serviços escutam somente em loopback.

Guia completo, versões, instalação reproduzível, testes, screenshots e limitações:
[`docs/CONTROL_TOWER.md`](docs/CONTROL_TOWER.md). Decisões no ADR-008 de
[`docs/DECISIONS.md`](docs/DECISIONS.md). Os comandos históricos do MVP 0 abaixo
continuam descrevendo o núcleo/CLI sem dependências; para descobrir **todos** os
testes agora, use o Python da `.venv`, que inclui FastAPI e HTTPX.

**Predict → Rescue → Explain.** Projeto educacional independente, com eventos totalmente simulados, para praticar AI Building, engenharia de workflows e avaliação de agentes.

## Visão

Um único produto com três módulos conectados por um log de eventos:

1. **SurgeShield** — detecta sobrecarga operacional e compara cenários simulados.
2. **RescueOps** — identifica pedidos em risco e propõe intervenções limitadas, aprovadas por humano.
3. **FairTrace** — reconstrói cronologias, distingue observações de hipóteses e gera dossiês verificáveis.

O painel central é a **Control Tower**, que mostra o que está acontecendo, por que uma intervenção é proposta e o que a simulação mostra como consequência.

## Primeira missão (MVP 0)

Criar um replay local de eventos que lê `fixtures/demo_events.jsonl`, valida os eventos, ignora duplicidades por `event_id`, ordena-os por tempo e exibe:

- status final de cada pedido;
- pedidos entregues após o prazo e minutos de atraso;
- pedidos cancelados;
- eventos que justificam o estado de cada pedido;
- avisos de dados insuficientes, sem inventar causas.

Não criar frontend, agentes, MCP, API ou n8n nesta primeira missão. Não usar serviços pagos. A implementação será delegada ao Codex e supervisionada por você.

## Documentos

- `docs/PRD.md` — produto e requisitos.
- `docs/ARCHITECTURE.md` — visão técnica, contrato dos eventos e limites.
- `docs/ROADMAP.md` — evolução por entregas e habilidades.
- `docs/DECISIONS.md` — decisões e justificativas.
- `docs/HANDOFF.md` — registro do estado do projeto.
- `FIRST_TASK_FOR_CODEX.md` — prompt para iniciar implementação.
- `AGENTS.md` — regras de trabalho do Codex neste repositório.

## Como começar no Windows

1. Extraia o pacote em uma pasta de projeto e abra essa pasta no VS Code.
2. Confira `docs/PRD.md`, `docs/ARCHITECTURE.md` e `fixtures/demo_checks.md`.
3. Abra o Codex e envie o conteúdo de `FIRST_TASK_FOR_CODEX.md`.
4. Leia o plano proposto pelo Codex **antes** de autorizar mudanças.
5. Depois da implementação, confira os valores de `fixtures/demo_checks.md` e execute os testes de verdade.

## Limites importantes

Projeto independente e não afiliado ao iFood. Não utiliza dados reais, credenciais, marcas em interfaces como se fosse oficial, nem APIs internas da empresa. Nenhuma estimativa de impacto é apresentada como resultado operacional real.

## Fase 0 — etapa 1 implementada

Ingestão local: leitura JSONL, contrato v0.1, timestamps com offset,
deduplicação e conflitos. Etapas 1 a 3 aprovadas; Reporting & CLI da Etapa 4
implementados e aguardando revisão independente. Veja o comando completo abaixo.
Python 3.11 ou superior, somente biblioteca padrão; validado com Python 3.14.4.

No PowerShell, a partir da raiz do repositório:

```powershell
Set-Location D:\rescueos_starter
python -m unittest discover -s tests -v
python -c "from rescueos.ingest import read_jsonl; r = read_jsonl('fixtures/demo_events.jsonl'); print('aceitos:', len(r.events), 'erros:', len(r.errors), 'grupos duplicados:', len(r.duplicates))"
```

A segunda chamada inspeciona a ingestão e não grava arquivos. A fixture atual
contém 20 eventos válidos. A API `read_jsonl(path)` retorna:

- `events`: eventos válidos únicos, em ordem de ID, sem replay temporal;
- `origins_by_id`: arquivo, linha e texto original de cada ocorrência identificável;
- `errors`: erros de leitura de linha, validação e conflitos;
- `duplicates`: diagnóstico de grupos de reenvios idênticos válidos.

Somente `events` alimentará o negócio. Duplicatas podem alterar diagnósticos e
origens, mas não esse conjunto. Estados, métricas e relatórios futuros deverão
usar `events`, sem incluir contagens de duplicatas em resultados de negócio.
Esta etapa testa a igualdade dessa entrada; ainda não testa relatórios inexistentes.

Mesmo ID com qualquer conteúdo divergente gera `EVENT_ID_CONFLICT` e exclui
todas as variantes, incluindo uma variante válida que conflite com outra inválida.
O erro guarda todas as origens, pedidos e tipos afetados e avisa sobre possíveis
lacunas em métricas dependentes. Nenhuma métrica é calculada nesta etapa.

### Exemplos de ingestão

Evento válido:

```json
{"event_id":"evt-example","order_id":"ord-example","restaurant_id":"rest-01","occurred_at":"2026-10-29T18:01:00-03:00","type":"KITCHEN_STARTED","data":{}}
```

Duplicado: uma segunda linha idêntica à anterior, inclusive com as propriedades
em outra ordem ou espaços diferentes. Resultado: um evento aceito e diagnóstico
`DUPLICATE_EVENT`, com ambas as origens.

Conflitante, quando recebido junto do válido acima:

```json
{"event_id":"evt-example","order_id":"ord-example","restaurant_id":"rest-01","occurred_at":"2026-10-29T18:02:00-03:00","type":"KITCHEN_STARTED","data":{}}
```

Resultado: nenhum evento desse ID aceito; `EVENT_ID_CONFLICT` preserva as duas linhas.

Inválido, por ausência de offset:

```json
{"event_id":"evt-invalid","order_id":"ord-example","restaurant_id":"rest-01","occurred_at":"2026-10-29T18:01:00","type":"KITCHEN_STARTED","data":{}}
```

Resultado: rejeição com `INVALID_TIMESTAMP`; outras linhas continuam sendo lidas.

### Limites do leitor

O processamento agrupa o arquivo completo em memória, sem deduplicação persistente
entre chamadas. Erros de abertura/leitura do arquivo propagam `OSError`; linhas
inválidas ficam em `errors`. Linhas vazias, BOM, chaves JSON repetidas, números não
finitos e UTF-8 inválido são rejeitados explicitamente. Texto recebido nunca é executado.
Detalhes do contrato e da identidade estão em `docs/DECISIONS.md`.

Após a correção da Code Review #001, JSON malformado gera `INVALID_JSON`;
números JSON fora dos limites locais geram `INVALID_NUMBER`, preservando o ID
identificável para análise de conflitos. A leitura continua após essas linhas.
Limites: literal de até 128 caracteres, inteiros signed int64, coeficiente decimal
de até 100 dígitos e expoente explícito de -308 a 308, sem overflow ou underflow
para zero na conversão float. Consulte ADR-004 para detalhes e limitações.

Regressões numéricas específicas:

```powershell
python -B -m unittest tests.test_numeric_ingest -v
```

## Etapa 2 — Event Replay Engine

O motor recebe a saída da ingestão e reconstrói timelines e o último estado
aplicável, preservando evidências de inconsistências. Preparo e chegada do
entregador são acompanhados independentemente. As transições e políticas de
ambiguidade estão no ADR-005 em `docs/DECISIONS.md`.

Execute na raiz do repositório, no PowerShell:

```powershell
python -B -m unittest tests.test_replay -v
python -B -m unittest discover -s tests -v
python -B -c "from rescueos.ingest import read_jsonl; from rescueos.replay import replay; r = replay(read_jsonl('fixtures/demo_events.jsonl')); print([(k, v.status, v.resolution) for k, v in r.orders.items()]); print('inconsistencias:', len(r.inconsistencies))"
```

Para inspecionar a timeline de `ord-1002`, sem gerar arquivos:

```powershell
python -B -c "from rescueos.ingest import read_jsonl; from rescueos.replay import replay; r = replay(read_jsonl('fixtures/demo_events.jsonl')); print([(e.event['event_id'], e.event['occurred_at'], e.event['type']) for e in r.orders['ord-1002'].timeline])"
```

Saída da API: `orders` (pedidos criados), `orphan_histories` (históricos sem criação),
`operational_context` (capacidade/promoção), `ingestion_errors` (diagnósticos da
Etapa 1) e `inconsistencies` (visão conjunta das inconsistências de replay).
Um pedido ambíguo usa `status=None`, `resolution='AMBIGUOUS'`. Eventos rejeitados
pela ingestão não entram nas timelines. Não há cálculos de atraso nesta etapa.

## Etapa 3 — Metrics & Evidence Engine

`compute_metrics(ReplayResult)` calcula cinco métricas por pedido, contagens e taxas
com elegibilidade explícita. Valores em minutos e taxas usam `Fraction` da biblioteca
padrão, mantendo precisão exata. Fontes incluem IDs, campos, timestamps e origens.
Disponibilidade é avaliada por dependência; consulte as políticas do ADR-006.

No PowerShell, a partir da raiz do repositório:

```powershell
python -B -m unittest tests.test_metrics -v
python -B -m unittest discover -s tests -v
python -B -c "from rescueos.ingest import read_jsonl; from rescueos.replay import replay; from rescueos.metrics import compute_metrics; r = compute_metrics(replay(read_jsonl('fixtures/demo_events.jsonl'))); print({k: str(a.value) for k, a in r.aggregates.items()}); print(r.orders['ord-1002'].metrics['delivery_delay'])"
```

O comando inspeciona resultados em memória. `available=False` usa `value=None`,
com motivo explícito. Não converta indisponibilidade em zero. Leia resolução,
qualidade local e qualidade do pedido junto do valor. Agregados registram IDs
excluídos, motivos, numerador, denominador e critérios. Dados são sintéticos.
A Etapa 4 abaixo implementa os exportadores e define a serialização no ADR-007.

## Etapa 4 — Reporting & CLI

O MVP executável integra ingestão, replay e métricas sem alterar suas interfaces.
No Windows PowerShell, com Python 3.11 ou superior e apenas biblioteca padrão:

```powershell
Set-Location D:\rescueos_starter
python -B -m rescueos --input fixtures/demo_events.jsonl --output-dir out
python -B -m rescueos --help
python -B -m unittest tests.test_reporting tests.test_cli -v
python -B -m unittest discover -s tests -v
```

Saídas: `out/summary.json` (dados estruturados), `out/report.md` (leitura humana)
e `out/errors.json` (diagnósticos e origens físicas). O contrato versionado está
no ADR-007 de `docs/DECISIONS.md`. Uma fração é representada por
`{"numerator": 1, "denominator": 3}`; indisponibilidade permanece `null` com motivo,
e nunca vira zero. COMPLETE/PARTIAL qualificam a população, não a disponibilidade.

Na fixture: 3 criados, 2 entregues, 1 cancelado, 1 entrega atrasada e 1 no prazo;
taxa de atraso 1/2 e de cancelamento 1/3. Dados e resultados são sintéticos.

Códigos de saída: **0** significa relatórios publicados, inclusive quando existem
erros de dados não fatais; **1** significa falha de leitura/escrita;
**2** significa argumentos ou caminhos inválidos. `--help` retorna 0.
Consulte `errors.json` mesmo após código 0: ERROR pode rejeitar um registro sem
interromper o arquivo; WARNING aponta inconsistências e INFO registra duplicatas.

O arquivo original é preservado. Destinos coincidentes com a entrada (incluindo
hardlinks), links simbólicos e destinos que sejam diretórios são rejeitados.
Reexecuções substituem apenas os três arquivos conhecidos. Todos são preparados
em temporários antes da publicação, com substituição atômica por arquivo e
restauração em falhas comuns de I/O. Não há transação contra queda de energia,
interrupção abrupta ou escrita concorrente. Uma restauração que também falhe pode
deixar um conjunto misto: o erro informa os backups mantidos para recuperação.

Entrada/configuração idênticas geram bytes idênticos. Reordenação mantém os
relatórios de negócio; a auditoria pode mudar por causa das linhas físicas.
Duplicatas mudam somente auditoria. `run_id` é um hash da projeção exportada,
não uma identificação única de tentativa ou hash dos bytes do arquivo original.
Payloads arbitrários e linhas brutas não são exportados; errors.json mantém
origens e hashes dos textos para consulta à entrada preservada. Nomes e caminhos
locais podem aparecer nos diagnósticos. Não é um arquivo completo de restauração.
