# Handoff / estado do projeto

**Estado atual:** Etapas 1 a 3 aprovadas; correção da Code Review #004 implementada, aguardando revisão independente.

**Próxima tarefa:** revisão independente de Reporting & CLI, schema e publicação do ADR-007. Aguardar aprovação antes de ampliar o escopo.

**Evidências disponíveis:** PRD, arquitetura, gabarito das fixtures e decisões.

**Não concluído:** dashboard, API HTTP, n8n, agente, MCP, deploy e medições reais.

**Arquivos criados:** `rescueos/__init__.py`, `rescueos/contracts.py`,
`rescueos/ingest.py`, `tests/__init__.py`, `tests/test_ingest.py`.
**Documentos atualizados:** `README.md`, `docs/DECISIONS.md`, `docs/HANDOFF.md`.

**Ambiente conferido antes das mudanças:** diretório atual e raiz Git
`D:\rescueos_starter`; `git status --short` vazio. Nenhuma subpasta de projeto criada.

**Verificação executada:** `python -m unittest discover -s tests -v` — 23 testes,
todos aprovados, Python 3.14.4. Inclui ingestão dos 20 eventos originais e conferência
de bytes da fixture, duplicatas, conflitos com origens, dados/timestamps inválidos,
UTF-8 inválido, continuidade após erro e texto tratado somente como dado.
Não foram executados testes de replay ou métricas, pois não foram implementados.

**Limitações:** entrada completa agrupada em memória; identidade não persistida
entre chamadas; erros de arquivo propagam `OSError`. Consequências de conflitos
são sinalizadas por pedidos/tipos, sem calcular métricas. Confirmar contrato de
`data` e perfil de timestamp detalhados no ADR-004. Sem dependências instaladas,
fixtures alteradas, commit ou push.

**Ao encerrar cada sessão:** registrar arquivos alterados, comandos e resultados executados, decisões, pendências e próximo passo. Não declarar testes como aprovados sem executá-los.

## Correção da Code Review #001 — 2026-10-29

Estado: dois bugs numéricos corrigidos; aguardando revisão. Não avançar para replay.
O estado Git inicial desta correção já continha README/DECISIONS/HANDOFF modificados
e `rescueos/` e `tests/` não rastreados; esse trabalho foi preservado.

Arquivos desta correção: `rescueos/ingest.py`, novo `tests/test_numeric_ingest.py`,
`README.md`, `docs/DECISIONS.md` e este handoff. `contracts.py` e os 23 testes
anteriores em `tests/test_ingest.py` não foram alterados.

Testes escritos e executados antes da correção:
`python -B -m unittest tests.test_numeric_ingest -v` — 4 testes;
2 erros `decimal.InvalidOperation` e 3 falhas de asserção (incluindo dois subtestes
de ordem das variantes). Depois da correção, os mesmos 4 testes passaram.

Uma execução intermediária da suíte de 27 testes encontrou 1 falha por diagnósticos
de contrato em cascata após erro numérico. A correção priorizou os diagnósticos
numéricos nessa linha, preservando os testes antigos sem alteração.

Verificação final: `python -B -m unittest discover -s tests -v` — 39 testes,
todos aprovados em Python 3.14.4 (23 anteriores + 16 novos). Inclui limites,
continuidade, conflitos em ambas as ordens, origens completas, JSON malformado,
arrays e independência do contexto Decimal. Políticas e riscos residuais no ADR-004.

Sem instalação de dependências, commit, push, replay, métricas ou exportadores.

## Etapa 2 — Event Replay Engine — 2026-10-29

Antes de editar: diretório e raiz Git `D:\rescueos_starter`; `git status --short`
vazio. Lidos AGENTS, PRD, ARCHITECTURE, DECISIONS, HANDOFF, fixture e gabarito,
README, módulos de ingestão/contratos e os 39 testes existentes.

Criados `rescueos/replay.py` e `tests/test_replay.py`; atualizados README,
DECISIONS (ADR-005) e este handoff. Ingestão e testes anteriores preservados.

Arquitetura: função pura `replay(IngestResult)`, ordenação por instante UTC/ID,
agrupamento por pedido, contexto separado, redução com pré-requisitos e auditoria.
Regras intermediárias e resolução de ambiguidades foram explicitadas no ADR-005,
pois a arquitetura inicial só fixava terminais e princípios de integridade.

Verificação nova: `python -B -m unittest tests.test_replay -v` — 30 testes passaram.
Inclui fixture completa, dez embaralhamentos determinísticos, offsets, empates,
microssegundos, extremos do calendário, órfãos, contexto, transições, cancelamento,
restaurantes divergentes, múltiplas criações, terminais contraditórios, integração
com duplicatas/conflitos e preservação das origens e dos dados de entrada.

Suíte completa executada: `python -B -m unittest discover -s tests -v` — 69 testes
passaram (39 da ingestão + 30 de replay). Comandos de demonstração do README
executados: três pedidos CONSISTENT, ord-1001/ord-1002 DELIVERED e ord-1003 CANCELLED;
zero inconsistências na fixture. Timeline ord-1002: evt-004, evt-006, evt-011,
evt-015, evt-017, evt-018, evt-020, preservando timestamps originais com offset.

`git diff --check` e verificações equivalentes nos dois arquivos novos passaram.
`git diff --exit-code -- fixtures/ rescueos/ingest.py rescueos/contracts.py
tests/test_ingest.py tests/test_numeric_ingest.py` confirmou ausência de alterações
nas fixtures e na Etapa 1. Sem instalação de dependências, commit ou push.

Limitações: somente eventos previamente aceitos; projeção em memória; resultados
com dicionários mutáveis, sem compartilhá-los com a entrada. Status é o último
estado aplicado sob as regras conservadoras; histórico incompleto ou inconsistente
não autoriza inferências de etapas, horários ou causas. Casos ambíguos usam status
None e resolution AMBIGUOUS. Métricas, exportadores e interface não implementados.

## Correção da Code Review #002 — 2026-10-29

Estado: correções concluídas, aguardando aprovação. Não avançar o escopo.
Antes de editar: `git status --short` mostrava README/DECISIONS/HANDOFF modificados
e replay.py/test_replay.py não rastreados. Trabalho prévio preservado.

Modificados nesta correção: `rescueos/replay.py`, `tests/test_replay.py`, ADR-005
em `docs/DECISIONS.md` e este handoff. README, ingestão, fixtures e os testes
anteriores da ingestão não foram alterados.

Antes da implementação: adicionadas duas regressões e executado
`python -B -m unittest tests.test_replay.Review002RegressionTests -v` — dois testes,
duas falhas reproduzidas: resolução CONSISTENT apesar do conflito conhecido e
ausência de EVENT_AFTER_TERMINAL combinada com RESTAURANT_MISMATCH.
Após a implementação, o mesmo comando passou com dois testes.

Verificação ampliada:
`python -B -m unittest tests.test_replay.Review002RegressionTests tests.test_replay.Review002IntegrationTests -v`
— 12 testes novos passaram. Incluem conflitos em cancelamento, entrega, criação
e demais marcos, ambas as ordens de chegada, terminais contraditórios aceitos,
históricos órfãos, conflitos sem eventos aceitos, múltiplos pedidos afetados,
pedidos não afetados, preservação das origens e dez embaralhamentos determinísticos.

`python -B -m unittest discover -s tests -v` — 81 testes passaram, mantendo os 69
anteriores. Nenhum teste anterior foi removido ou reescrito.

Decisão: estado calculado permanece baseado nos eventos aceitos; qualidade
INCOMPLETE e conflitos associados qualificam os pedidos afetados. Resolution
INCOMPLETE só substitui CONSISTENT; AMBIGUOUS e INCONSISTENT têm precedência.
Conflito não é transição inválida. Diagnósticos sem projeção não criam pedidos.
Ambas as violações pós-terminal/restaurante são registradas antes do descarte.

Limitações: associação restrita a affected_order_ids dos conflitos de ingestão;
sem garantia de completude quando não há conflito conhecido. Mantidas as regras
para eventos anteriores à criação e o processamento em memória. Sem dependências,
commit, push ou novas funcionalidades fora da correção.

Checks finais: `git diff --check` e checks de whitespace dos dois arquivos novos
passaram. `git diff --exit-code -- fixtures/ rescueos/ingest.py rescueos/contracts.py
tests/test_ingest.py tests/test_numeric_ingest.py` confirmou que fixtures e Etapa 1
permanecem intactas. Reproduções originais agora retornam DELIVERED/INCOMPLETE
com conflito associado, e ambas as violações pós-terminal/restaurante.
Diff incremental desta correção disponível em `out/review002.diff` para revisão.

## Etapa 3 — Metrics & Evidence Engine — 2026-10-29

Antes de editar: diretório e raiz Git `D:\rescueos_starter`, estado Git limpo.
Lidos AGENTS/PRD/ARCHITECTURE/DECISIONS/HANDOFF, fixtures e gabarito; inspecionadas
as interfaces reais de contratos, ingestão e replay. Baseline executado:
`python -B -m unittest discover -s tests -v` — 81 testes aprovados.

Criados `rescueos/metrics.py` e `tests/test_metrics.py`. Atualizados README,
DECISIONS (ADR-006) e este handoff. Sem mudanças nas interfaces anteriores.

Contrato: `compute_metrics(ReplayResult) -> MetricsResult`; cinco métricas por pedido
com Fraction exato, fontes por campo, IDs de apoio, motivos e qualidade local.
Agregados com elegibilidade, exclusões, critérios e taxas com numerador/denominador.
Pedidos órfãos ou conhecidos só por diagnósticos não viram pedidos artificiais.
Históricos parcialmente confiáveis são avaliados por dependência, propagando os
metadados de resolução e evidência originais do pedido.

Executado `python -B -m unittest tests.test_metrics -v` — 33 testes aprovados,
incluindo gabarito, segundos/microssegundos, offsets, virada de dia, ausência de
eventos, espera negativa, cancelamento, ambiguidade, conflitos, denominadores,
lineage e determinismo. Nenhum teste anterior alterado.

Pendências de revisão: políticas de dependência transitiva, contagens elegíveis e
denominadores do snapshot, e representação Fraction em futuros exportadores.
Limites: memória local, entrada íntegra do replay, avaliação conservadora de
conflitos por tipo, sem estimativa para pedidos desconhecidos em linhas ilegíveis.
Sem instalação, commit, push, frontend, APIs, agentes, ML ou exportadores finais.

Validação completa executada: `python -B -m unittest discover -s tests -v` —
114 testes aprovados (81 anteriores + 33 novos), Python 3.14.4. Demonstração real
confirmou valores individuais do gabarito; agregados 3 criados, 2 entregues,
1 cancelado, 1 atrasado, 1 no prazo; taxas exatas 1/2 e 1/3.
Lineage ord-1002: entrega evt-004/evt-020; cozinha evt-004/evt-017;
espera evt-015/evt-018, com campos, timestamps e números de linha preservados.

`git diff --check` e checks dos dois arquivos novos passaram.
`git diff --exit-code -- fixtures/ rescueos/contracts.py rescueos/ingest.py
rescueos/replay.py tests/test_ingest.py tests/test_numeric_ingest.py tests/test_replay.py`
confirmou fixtures, interfaces e testes anteriores sem mudanças.
Diff completo da Etapa 3 para revisão em `out/stage3-review.diff`.

## Correção da Code Review #003 — 2026-10-29

Retomada sem reiniciar a implementação: raiz Git D:/rescueos_starter; mudanças
anteriores em README, DECISIONS e HANDOFF, com metrics.py e test_metrics.py ainda
untracked. Já existiam dois testes de regressão criados antes da interrupção.
Antes da correção ambos falharam: esperado NOT_DELIVERED, obtidos respectivamente
INCONSISTENT_DEPENDENCY e CONFLICTING_DEPENDENCY. A execução foi registrada com
`python -B -m unittest tests.test_metrics.Review003RegressionTests -v`.

Correção restrita à classificação das populações: verificar criação, identidade
e desfecho antes da cadeia de entrega. Cancelados confiáveis ficam fora da
população como NOT_DELIVERED, preservando problemas locais. Criação ou terminais
comprometidos continuam bloqueando a classificação; entregues continuam exigindo
cadeia íntegra e desvio disponível. Nenhuma alteração na aritmética individual.

ADR-006 documenta COMPLETE/PARTIAL nos agregados, separados da disponibilidade.
Denominador conhecido vazio mantém valor None e ZERO_DENOMINATOR, sem inventar
taxa zero; sua qualidade pode ser COMPLETE. Métricas individuais mantêm o contrato
anterior, inclusive SUFFICIENT e evidências de inconsistências/conflitos.

Adicionados dez testes ao todo (duas regressões e oito verificações adicionais).
`python -B -m unittest tests.test_metrics -v`: 43 testes aprovados.
`python -B -m unittest discover -s tests -v`: 124 testes aprovados, incluindo os
114 anteriores. Cobertura adicional: criação/terminais comprometidos, ambas as
cronologias contraditórias, cadeia de entrega inconsistente, população só cancelada,
população mista, frações exatas, evidências e dez embaralhamentos determinísticos.

`git diff --check` passou. Fixtures, módulos e testes das Etapas 1/2 permanecem
intactos em relação ao Git. README preexistente foi preservado. Sem dependências,
commit, push ou avanço à Etapa 4. Pendente revisão independente da classificação
e da distinção entre qualidade da população e disponibilidade da taxa. Permanecem
os limites de snapshot em memória e avaliação conservadora dos conflitos por tipo.

Comparação adicional em memória com o código anterior à correção: métricas
individuais completas (incluindo fontes e diagnósticos) e valores/numeradores/
denominadores dos agregados idênticos em sete snapshots, incluindo a fixture.
Os 33 testes originais de métricas foram comparados textualmente e preservados.
Exemplos reais: entregue + cancelado com conflito de entregador => taxa 1/1,
COMPLETE, exclusão NOT_DELIVERED. Acrescentar desfecho de outro pedido comprometido
=> mesma taxa observada 1/1, PARTIAL, exclusão CONFLICTING_DEPENDENCY adicional.

## Etapa 4 — Reporting & CLI — 2026-10-29

Preparação: raiz Git D:/rescueos_starter, git status vazio. Lidos AGENTS, PRD,
ARCHITECTURE, DECISIONS, HANDOFF, gabarito e interfaces reais. Baseline executado:
`python -B -m unittest discover -s tests -v` — 124 testes aprovados.

Criados rescueos/reporting.py, rescueos/__main__.py, tests/test_reporting.py e
tests/test_cli.py. Atualizados README, ADR-007 e este handoff. Sem alterações nas
Etapas 1/2/3, contratos ou fixtures. CLI liga as interfaces públicas existentes:
JSONL -> ingestão -> replay -> métricas -> relatórios. Sem duplicar cálculos.

Schema 1.0: summary.json com projeções, métricas, populações e referências;
report.md legível; errors.json com diagnósticos, origens e catálogo de evidências.
Fraction vira objeto numerator/denominator; None permanece null. run_id é SHA-256
da projeção exportada (não dos bytes originais), sem relógio ou aleatoriedade.
Origens físicas e duplicatas ficam na auditoria para preservar relatórios de negócio.
Payloads arbitrários/linhas brutas não são exportados: usar referências à entrada
preservada e raw_text_sha256 para examinar variantes. Markdown escapa texto recebido.

Códigos: 0 com publicação concluída, inclusive erros de dados não fatais; 1 para I/O;
2 para argumentos/caminhos inválidos. Origem nunca é substituída; proteção também
contra alias/hardlink e destinos simbólicos. Temporários preparados antes de
publicar, fsync e os.replace por arquivo; rollback de erros comuns de I/O.
Falha também no rollback preserva backups de recuperação e informa caminhos.
Limites: sem transação de três arquivos contra queda/interrupção, sem lock ou
escritores concorrentes; textos e backups completos em memória. API de renderização
exige objetos íntegros da mesma execução. COMPLETE não cobre registros desconhecidos.

Primeira execução dos 38 testes novos detectou três falhas de asserção de códigos
no Markdown: códigos apareciam corretamente escapados com barras antes de `_`.
As asserções foram ajustadas à representação Markdown, preservando os testes JSON.
Adicionados ainda cenários de rollback, falha após staging inicial e proteção de links.

Validação completa: `python -B -m unittest discover -s tests -v` — 166 testes,
165 aprovados e 1 ignorado. Os 124 anteriores continuam aprovados. O caso ignorado
exige criar symlink real, bloqueado pelo WinError 1314 neste Windows; guard de symlink
testado com mock e teste real de hardlink executado. Cobertura: fixture/gabarito,
schema e frações, null, COMPLETE/PARTIAL, duplicatas/conflitos, órfãos/ambiguidade,
determinismo, Unicode e texto não confiável, CLI em subprocesso, entrada preservada,
erros de argumentos/I/O e restauração em falhas simuladas. Sem dependências, commit
ou push. Interromper após a entrega e aguardar revisão independente.

CLI real executada duas vezes:
`python -B -m rescueos --input fixtures/demo_events.jsonl --output-dir out`.
Gerados summary.json, report.md e errors.json; confirmados todos os valores do
gabarito, 20 eventos no catálogo, nenhum diagnóstico e None nas métricas do cancelado.
SHA-256 dos três arquivos permaneceu idêntico na reexecução. A CLI usa UTF-8 também
nos pipes do Windows. JSON/Markdown em UTF-8/LF conferidos pelos testes.

Checks finais: git diff --check passou; whitespace dos quatro arquivos novos
conferido separadamente. git diff --exit-code confirmou fixtures e módulos/testes
anteriores intactos. Diff consolidado, incluindo untracked, em out/stage4-review.diff.
Pendente revisão independente do schema, redação dos avisos e limites de atomicidade.

## Correção da Code Review #004 — 2026-10-29

Confirmados diretório/raiz Git D:/rescueos_starter e alterações existentes: README,
DECISIONS e HANDOFF modificados; reporting.py, __main__.py e testes correspondentes
untracked. Preservado esse trabalho; lidos AGENTS, documentos e interfaces atuais.

Primeiro adicionadas duas regressões, executadas antes de corrigir:
`python -B -m unittest tests.test_reporting.ReportPublicationTests.test_rollback_and_cleanup_failures_do_not_mask_publication_error tests.test_cli.CliTests.test_closed_stdout_subprocess_returns_one_and_preserves_reports -v`.
Ambas falharam: mensagem apenas secondary cleanup failure, perdendo a falha primária;
e código 120 no subprocesso Windows com stdout fechado, com erro no flush final.

Correções: ReportWriteError (subclasse de OSError) separa erro original, falhas de
rollback, falhas de limpeza e backups protegidos. Limpeza tenta todos os temporários
sem mascarar a causa primária; vale também para staging que falha antes do registro.
Publicação concluída com falha apenas na limpeza é distinguida de publicação falha.
Não há nova alegação de atomicidade do conjunto ou suporte à concorrência.

CLI trata escrita/flush do terminal e neutraliza stdout com os.devnull após falha,
evitando código 120 no encerramento. Streams sem descritor são desativados em sys;
stderr é usado para o diagnóstico e protegido se também falhar. Saídas normais 0 e
2 preservadas; falha de I/O retorna 1. Não há mensagem de sucesso antes da publicação.

Adicionados dez testes ao todo, incluindo as duas regressões. Testes extras cobrem
falhas combinadas de staging/limpeza, rollback bem-sucedido com limpeza parcial,
falha só na limpeza após publicação, BrokenPipeError/OSError na escrita/flush,
erro de publicação sem tentativa de sucesso e ajuda/argumentos com stdout fechado.
Asserções de caminhos normalizam alias 8.3/nomes completos do Windows por resolve.

`python -B -m unittest tests.test_reporting tests.test_cli -v`: 52 testes,
51 aprovados, 0 falhos, 1 ignorado.
`python -B -m unittest discover -s tests -v`: 176 testes,
175 aprovados, 0 falhos, 1 ignorado. Os 165 anteriormente aprovados continuam
aprovados. Único skip investigado: WinError 1314 na criação de symlink real,
sem alteração de privilégios; guard por mock e hardlink real continuam passando.

Sondagem adicional: três subprocessos reais com stdout fechado retornaram 1,
sem erro de encerramento, e mantiveram relatórios completos. Os três artefatos
da fixture foram comparados em bytes com a saída anterior: idênticos. Serialização,
métricas, esquema, evidências e run_id não mudaram.

`git diff --check` e whitespace dos quatro arquivos novos passaram. Fixtures e
módulos/testes das Etapas 1/2/3 permanecem intactos em relação ao Git. README
preexistente preservado. Diff incremental da correção em out/review004.diff.
Sem dependências, commit, push ou avanço de escopo. Aguardar revisão independente
da recuperação de erros e tratamento dos streams. Permanecem limites de memória,
atomicidade por arquivo e ausência de proteção para escritores concorrentes.
