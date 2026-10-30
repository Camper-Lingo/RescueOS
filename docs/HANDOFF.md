# Handoff / estado do projeto

**Estado atual:** Etapa 5A aprovada e commitada em `2a66164`; polimento visual 5B implementado e validado localmente, aguardando revisão técnica e visual independente (2026-10-30). Etapas 1–4 e contratos 5A preservados.

**Próxima tarefa:** revisão independente da Etapa 5B, incluindo capturas e custo gráfico medido. Não fazer commit/push nem iniciar a Etapa 6 sem revisão do usuário.

**Evidências disponíveis:** PRD, arquitetura, gabarito das fixtures e decisões.

**Não concluído:** n8n, agentes, MCP, deploy e medições de operações reais. API local e interface 3D demonstrativa descritas no registro da Etapa 5A abaixo.

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

## Etapa 5A — The Living Restaurant — 2026-10-30

Estado: implementada para revisão independente. Não fazer commit/push nem avançar
o escopo automaticamente. Guia: `docs/CONTROL_TOWER.md`; decisão: ADR-008.

Preparação inicial: diretório e raiz Git D:/rescueos_starter, árvore limpa; lidos
AGENTS, README, PRD, ARCHITECTURE, DECISIONS, HANDOFF, fixture/gabarito e interfaces
públicas. Não havia Control Tower parcial. Baseline real: 176 testes Python,
175 aprovados, 1 skip de symlink por WinError 1314.

Retomada após interrupção: já existiam a stack local, API/snapshot/modelos,
13 testes API aprovados, cena procedural e componentes iniciais da interface,
timeline e evidências. Todos foram preservados e inspecionados. O handoff antigo
ainda descrevia a revisão da Etapa 4; este registro documenta o trabalho da 5A.
O primeiro build da retomada falhou por import não usado; os indicadores HTML
também usavam nomes diferentes do contrato real. Corrigidos sem tocar no núcleo.

Instalação explicitamente autorizada pelo usuário: FastAPI/Uvicorn/HTTPX na
`.venv`, React/DOM/Three/Fiber/Drei/Vite/TypeScript/Playwright e tipos em
`frontend/node_modules`. A primeira tentativa pip foi rejeitada pela aprovação
automática antes dessa autorização; o usuário autorizou e a instalação local
posterior concluiu. Usado npm.cmd, sem alterar ExecutionPolicy. Versões diretas
e transitivas Python em requirements-tower.txt; frontend em package-lock.json.

Backend novo em `rescueos/tower/`: seis GETs versionados, lifespan com snapshot
serializado imutável, cópias por resposta e modelos explícitos. Reutiliza as
Etapas 1–4 em memória; não publica relatórios. Replay com 20 eventos/21 quadros,
ordenado por instante UTC/ID. Auditoria completa é conhecida em todos os quadros;
variantes conflitantes nunca são reinseridas. Fraction vira strings de inteiros
no contrato HTTP; null preservado. Não mudou o JSON da CLI.

Frontend novo em `frontend/`: cena isométrica procedural com cozinha/fogão/coifa,
retirada/prateleiras/portal, estação de evidências, console e decoração; cinco
mascotes originais Scout/Fixer/Trace/Runner/Coordinator, idle e deslocamentos via
refs; pacotes por estado aplicado. Seleção por cena e HTML, foco de câmera,
replay play/pause/restart/anterior/próximo/slider/1×/2×/4×, painel de evidências,
indicadores, diagnóstico, modos 3D/2D e redução de movimento. Movimentos decorativos
e papéis futuros são explicitamente identificados; nenhuma IA executa ações.

Validação visual real em Chrome/Windows, com SwiftShader no headless. Corrigidos
cortes de câmera, rótulos sobrepostos e sobreposição de textos na vista 2D móvel.
Rótulos Html do Drei causavam avisos de desmontagem do React; substituídos por
CanvasTexture local com descarte no unmount. API online, 3D visível, clique direto
em pacote, seleção dos três pedidos, cinco personagens, replay completo, retorno
para evt-015 sem métricas futuras e evidências reais conferidos. Primeira asserção
de timestamp no E2E usava horário errado; corrigida para o registro original
18:22 de evt-015 após comparar a fixture e a resposta real, sem alterar dados.

Comandos/resultados finais executados:

- `.\.venv\Scripts\python.exe -B -m unittest tests.test_tower_api -v`: 13/13.
- `.\.venv\Scripts\python.exe -B -m unittest discover -s tests -v`: 189 casos,
  188 aprovados, 0 falhas, 1 skip. Os 176 anteriores continuam presentes; symlink
  real ainda requer privilégio Windows. Guard por mock/hardlink passaram.
- `npm.cmd test` em frontend: 12/12, cliente HTTP/cursor/racionais/projeção visual.
- `npm.cmd exec tsc -- --noEmit`: exit 0, strict incluindo testes.
- `npm.cmd run build`: exit 0; chunk HTML/cliente 244,80 kB e cena lazy 949,43 kB
  (77,05 e 252,73 kB gzip), CSS 18,93 kB. Sem certificação de FPS.
- `npm.cmd run test:e2e`: 8/8, 25,4 s na execução final. API real + 3D + console sem erros no fluxo
  normal; clique Canvas/HTML, métricas e fontes, replay completo/backward/pause,
  ausência e perda de WebGL, loading/offline/HTTP/retry, viewport 390, preferência
  reduzida, ID inexistente, vazio e evidência ambígua/incompleta. Falhas/estados
  excepcionais do cliente usam interceptação de rede explicitamente nos testes.
- Sondagem independente de modelos HTTP com conflito, órfãos e terminais
  contraditórios, precedidos por número de expoente extremo: quatro recursos
  responderam 200 em cada caso, mantendo INCOMPLETE/AMBIGUOUS/ausência de pedidos.
- `git diff --check` e verificação de whitespace dos arquivos novos: passaram.
  `git diff --exit-code` confirmou fixtures e módulos/testes das Etapas 1–4 intactos.
  `pip check`: nenhum requisito quebrado. CSS foi formatado para revisão; o build
  confirmou a formatação sem mudança de artefatos. O ajuste visual final de rolagem
  do painel de evidências no desktop também passou pelo build e navegador.

Resultados reais da fixture: 3 criados, 2 entregues, 1 cancelado, 1 atrasado,
taxas exatas 1/2 e 1/3. ord-1001: antecedência 5/espera 1; ord-1002: atraso 13,
cozinha 11/espera 13; ord-1003: métricas de entrega indisponíveis. Fontes da espera
ord-1002: evt-015 (18:22, linha 15) e evt-018 (18:35, linha 18).

Screenshots locais ignorados pelo Git: `out/tower-desktop.png`,
`out/tower-evidence.png`, `out/tower-mobile-3d.png`, `out/tower-mobile-2d.png`.
Reproduzíveis pelo E2E; imagens inspecionadas visualmente. Diff consolidado com
arquivos novos em `out/stage5a-review.diff`, sem staging/commit.

Limites para revisão: fixture pequena/snapshot estático por processo; prefixos
completos quadráticos; auditoria estática nos quadros; um Runner para o pedido
selecionado; rótulos em ângulos extremos; somente Chrome/Windows validado, sem
garantias de FPS ou auditoria completa de acessibilidade. Starlette avisa que seu
adaptador TestClient com HTTPX está depreciado; testes passaram sem ocultar aviso.
Sem deploy, autenticação de produção, streaming, IA ou mudanças na publicação.
Antes de concorrência, aprovar coordenação/lock e publicação de gerações imutáveis
com manifesto transacional/recuperação; continuam os limites do ADR-007.

## Correção da Code Review #005 — 2026-10-30

Estado: cinco correções implementadas, aguardando revisão independente. Não fazer
commit/push nem avançar à Etapa 5B. Trabalho existente preservado, incluindo todos
os arquivos não rastreados; raiz Git confirmada como D:/rescueos_starter. Baseline
completo guardado em `out/review005-before.zip`; diff incremental em
`out/review005.diff`, sem staging. Não houve instalação ou alteração de versões.

Lidos AGENTS, HANDOFF, CONTROL_TOWER, ADR-008 e contratos/componentes relevantes.
Baseline reexecutado antes de corrigir: 189 testes Python (188 passaram/1 skip),
12 Node, 8 Playwright; TypeScript e build passaram. Skip existente por WinError 1314
em symlink real; sem alterar privilégios Windows.

RED antes de implementar:

- `.\.venv\Scripts\python.exe -B -m unittest tests.test_tower_review005 -v`:
  dois testes de regressão falharam, com cinco asserções: consulta individual por
  query retornava 404; surrogate aceito pelo núcleo gerava 500 em overview,
  orders, diagnostics e replay, enquanto health permanecia 200.
- `npm.cmd run test:e2e -- e2e/review005.spec.ts`: os quatro testes iniciais falharam
  (orders ausente, denominador zero, lazy import abortado, reset da câmera). Nos
  três primeiros, faltavam retry/fallback; o último não recuperava a imagem inicial.

GREEN e decisões:

1. JSON HTTP permanece unknown até validação runtime de metadados, estruturas,
   estados, métricas/disponibilidade, frações, fontes/origens e quadros. Verificar
   referências aos prefixos e projeções finais entre endpoints sem recalcular
   regras de negócio. Payload inválido não vira Bundle; erro recuperável com retry.
   Error Boundary geral contém falhas inesperadas de renderização.
2. Barreira da cena externa ao React.lazy protege importação e subárvore 3D. Falha
   mantém HTML/evidências/replay e vista 2D com os mesmos dados. Botão de recarga
   da cena recarrega a página explicitamente, reiniciando a sessão visual.
3. Reset monotônico restaura posição, target, orientação e zoom por viewport,
   mesmo com focus=null. Movimento reduzido imediato, normal suave com inércia
   suspensa durante o comando. Usuário pode interromper pela órbita manual.
4. Nova query GET `/api/v1/order`, com exatamente um de order_id/order_id_json.
   JSON-string transporta também unidades UTF-16 isoladas sem perda na URL.
   loadOrder usa JSON.stringify + URLSearchParams e valida a resposta individual.
   Rota de caminho mantida com conversor path; query é preferida diante de proxies.
5. EscapedJSONResponse explícita mantém response_model e usa JSON ASCII escapado,
   sem NaN. Evita o dump_json direto do Pydantic que falhava antes da criação da
   resposta. Lifespan verifica schema e serialização, inclusive pedidos individuais.
   Nenhum ID é normalizado ou substituído. Schema HTTP 1.0 e JSON da CLI preservados.

Os mesmos dois testes HTTP e quatro testes iniciais de navegador passaram após
as correções. Ampliados com arrays/tipos inválidos, frações incompletas, fontes,
estados/disponibilidade, recuperação, falha de renderização 3D/HTML, recarga da
cena, consulta pelo cliente real e comparação visual do reset. Servidor HTTP Node
real testa contratos/respostas inválidas e transporte de IDs sem casts forçados
para Bundle. IDs cobertos: normal, barra, ?, #, espaços, Unicode, emoji, caracteres
combinados e surrogate isolado; inválidos controlados em 422, inexistentes em 404.

Dois mocks antigos precisaram ficar completos/coerentes: o helper do cliente
omitia campos obrigatórios; o E2E de ambiguidade alterava apenas replay, deixando
orders divergente. Suas asserções foram preservadas; respostas de teste passaram
a cumprir o contrato, incluindo metadados locais das métricas. Nenhum teste foi
removido. Uma execução intermediária deu 19/20: o teste HTML procurava um nó de
texto solto por igualdade de elemento; ajustado o locator para o painel que
efetivamente continha “render recuperado”, sem alterar o comportamento da aplicação.

Verificação final executada:

- `.\.venv\Scripts\python.exe -B -m unittest tests.test_tower_review005 -v`: 5/5.
- `.\.venv\Scripts\python.exe -B -m unittest discover -s tests -v`: 194 casos,
  193 aprovados, 0 falhas, 1 skip existente; os 189 anteriores preservados.
- `npm.cmd test`: 14/14, incluindo 2 novos testes com múltiplos casos HTTP reais.
- `npm.cmd exec tsc -- --noEmit`: exit 0, strict.
- `npm.cmd run build`: exit 0, sem dependências novas.
- `npm.cmd run test:e2e`: 21/21 em 51,3 s na última execução (8 anteriores + 13 novos).

Chrome/Windows real com SwiftShader: restaurante e cinco mascotes mantidos,
seleção Canvas/HTML, replay completo, retorno temporal e fontes ord-1002 conferidos.
Screenshots regeneradas pelo E2E em out/tower-*.png; fallback após erro em
`out/review005-scene-fallback.png`. Imagens inspecionadas visualmente. Sondagem
adicional leu a câmera real via store R3F, com movimento normal: após órbita/zoom e
reset, posição voltou a [10,11,12], target [0,0,0], mesmo quaternion inicial e zoom
47.37864077669903 no viewport 1440×1080. Teste reduzido compara PNGs idênticos após
reset repetido, foco de zona e navegação no replay. Sem certificação de FPS/GPU.

Fixture mantém 20 eventos/21 quadros/3 pedidos, dois entregues e um cancelado;
ord-1002 com atraso 13/cozinha 11/espera 13, taxas 1/2 e 1/3, null preservado.
Fixtures, módulos/testes das Etapas 1–4, modelos procedurais, versões e lockfile
comparados byte a byte com o baseline e preservados. API local foi reiniciada para
carregar o adaptador corrigido. Diff/check e whitespace dos arquivos novos
conferidos antes da entrega, incluindo os não rastreados.

Integração adicional com respostas HTTP reais do TestClient alimentando o
validador TypeScript via Node: fixture, conflito com campos vazios em variante
inválida, histórico ambíguo, órfãos, duplicatas e surrogate. Todos aceitos pelo
validador, preservando diagnósticos; cada arquivo também começava com JSON
malformado, sem impedir a continuidade. Identificadores aceitos são não vazios;
strings inválidas das variantes rejeitadas continuam permitidas nos diagnósticos.

Limitações: consumidores Unicode estritos podem rejeitar surrogate isolado; Python
e JavaScript preservam sua representação JSON, mas fontes podem mostrar glifo de
substituição. Query JSON evita perda de identidade; não normalizar Unicode.
Validação de frontend deve acompanhar alterações futuras do contrato. Recarga da
cena reinicia o cursor. Mantidos snapshot pequeno/estático, prefixos quadráticos,
skip de symlink, depreciação HTTPX/TestClient e limites de publicação do ADR-007.
Pendente revisão independente dos cinco fixes, runtime validator e políticas de
transporte/serialização, sem exigir novas funcionalidades ou produção nesta etapa.

Revisão de simplicidade solicitada pelo usuário: skill Ponytail 5.3.3 encontrada
em `C:/Users/João/.codex/plugins/cache/ponytail/ponytail/5.3.3/skills/ponytail/SKILL.md`,
lida e ativada em FULL. Inspecionados os cinco fixes, seus chamadores e testes.
Mantidos os validadores locais compartilhados na fronteira HTTP, uma Error
Boundary reutilizada nos dois escopos, o contador de reset e o serializador da
biblioteca padrão. Não foi encontrada simplificação que justificasse outra
alteração de código; não houve refatoração apenas para reduzir linhas. As
verificações entre endpoints protegem a coerência dos dados exibidos sem duplicar
o motor de negócio. Nenhuma dependência, fábrica de componentes ou novo sistema
de estado foi introduzido pelas correções.

Inspeção visual final confirmou desktop, mobile 3D, evidências e fallback 2D do
mesmo quadro. Mantidos cena, cinco mascotes, animações e replay; modelos,
estilos e roster permanecem idênticos ao baseline. O diff incremental compara
bytes para identificar arquivos alterados e normaliza CRLF/LF somente para
apresentar as linhas, evitando incluir arquivos intactos por conversão de newline.

## Correção final #005 — identificadores Python/TypeScript — 2026-10-30

Raiz Git D:/rescueos_starter confirmada; alterações e arquivos não rastreados
preservados. Ponytail 5.3.3 carregado em FULL, sem hooks ou dependências novas.
Baseline dos 65 arquivos em `out/review005-identifiers-before.zip`; diff desta
correção em `out/review005-identifiers.diff`. Não fazer commit/push nem iniciar 5B.

Causa: `String.trim()` removia U+FEFF aceito por `str.strip()` no núcleo e deixava
passar U+001C–001F/U+0085, que o núcleo rejeita quando isolados. Substituído somente
o predicado compartilhado de identificadores em validation.ts por uma classe
explícita de caracteres fora dos 29 whitespaces Python 3.14/Unicode 16. Zero
transformações dos valores: sem trim, normalização, remoção ou substituição.
loadBundle e loadOrder reutilizam a correção; núcleo, API e componentes não mudaram.

Antes da correção, executado:
`.\.venv\Scripts\python.exe -B -m unittest tests.test_tower_review005.Review005IdentifierCompatibilityTests -v`
— quatro testes, quatro falhas: três campos com U+FEFF e divergências de whitespace
frente ao validate_event real. A primeira execução também expôs um assert libuv
no encerramento do Node/Windows após erro não tratado do teste. O runner passou a
capturar o erro e sinalizar exitCode=1; reexecutado RED com as mesmas quatro falhas
de contrato, sem o erro secundário, antes de alterar o produto. Após a correção,
o mesmo comando passou com quatro testes em 2,144 s.

Três testes exercitam dez IDs válidos por campo em JSONL temporário, ingestão e
API real via TestClient; respostas alimentam um servidor HTTP Node e os clientes
reais loadBundle/loadOrder. Incluem U+FEFF puro/cercado por whitespace, barra,
Unicode comum, emoji, combinados, surrogate isolado, U+180E/U+200B e espaços em
volta de conteúdo. Testam também payload inválido seguido de recuperação. O quarto
teste enumera os whitespaces do Python instalado e compara 177 casos (59 valores
por campo, incluindo vizinhos e strings vazias/mistas) ao validate_event real.
Verifica que a validação não modifica os dados. Testes anteriores preservados.

Validação geral executada:

- `.\.venv\Scripts\python.exe -B -m unittest discover -s tests -v`: 198 casos,
  197 aprovados, zero falhas, um skip existente; 26,577 s.
- `npm.cmd test`: 14/14.
- `npm.cmd exec tsc -- --noEmit`: exit 0.
- `npm.cmd run build`: exit 0.
- `npm.cmd run test:e2e`: 21/21, 1,2 min na execução final.
- `git diff --check` e whitespace dos arquivos alterados: sem erros.

Sondagem adicional Chrome/Windows com API Uvicorn temporária real: os três IDs
iguais a U+FEFF foram preservados; resposta inválida exibiu retry, e resposta válida
subsequente carregou restaurante 3D. Consulta individual pelo cliente retornou o
mesmo ID; null preservado e nenhum pageerror. Screenshot inspecionada em
`out/review005-identifiers.png`. A fixture oficial continua com 20 eventos,
21 quadros, três pedidos e métricas 13/11/13 de ord-1002; E2E preserva cinco
mascotes, animações, seleção, câmera, fallback, evidências e navegação temporal.

Somente validation.ts, test_tower_review005.py, CONTROL_TOWER.md e HANDOFF.md
alterados nesta correção. Demais fontes comparadas byte a byte com o baseline;
fixtures, módulos/testes das Etapas 1–4, personagens, estilos e lockfile intactos.
Limites: tabela deve acompanhar mudanças futuras no whitespace Python/Unicode;
IDs invisíveis continuam visualmente invisíveis, sem perda de identidade. Mantidos
skip de symlink Windows, aviso de depreciação TestClient/HTTPX e validação gráfica
por SwiftShader. Aguardando revisão independente, sem novas funcionalidades.

## Etapa 5B — Visual Polish & Immersion — 2026-10-30

Raiz `D:/rescueos_starter` e commit estável 5A `2a66164` confirmados antes das
mudanças. Ponytail 5.3.3 disponível e ativo em FULL. Sem dependências novas,
commit, push ou avanço para a Etapa 6. Baseline inicialmente limpo: Python
198 casos (197 aprovados e um skip), Node 14, strict/build aprovados e E2E 21.
Capturas anteriores foram preservadas antes de os testes regenerarem imagens.

Auditoria inicial em Chrome real/headless: cozinha/retirada reconhecíveis, mas
luz ambiente achatava materiais, Scout/Trace/Coordinator ficavam atrás de bancadas
e etiquetas competiam. Prioridades: profundidade, visibilidade dos cinco,
hierarquia dos rótulos e integração HTML. Riscos previstos: oclusão e custo gráfico.

Incrementos implementados e inspecionados:

- A/B: ambiente mais contido, preenchimento frio e luz principal quente; piso
  quadriculado procedural, acabamentos da plataforma, forno/coifa, prateleira,
  monitor auxiliar e filetes emissivos estáticos, sem novo mapa de sombra.
- C: cinco mascotes preservados no mesmo componente. Scout com sensor peitoral;
  Fixer com avental/botas; Trace mais largo com lente; Runner com boné/bolsa;
  Coordinator com headset/tablet. Respiração, inclinação, piscar e braços/pernas
  alternados usam refs e fases fixas. Movimento reduzido interrompe decoração.
  Scout, Trace e Coordinator saíram de trás das bancadas; Runner mantém os marcos.
- D: mesma arquitetura/counter de reset; alvo de zona em y=0,35 e aproximação 1,12×,
  zoom limitado a 18–85. Visão geral restaura posição/orientação/alvo/zoom mesmo
  após órbita, scroll e comandos repetidos, instantaneamente em reduced motion.
- E: refinamento dos estilos existentes, cena com mais espaço, cores coordenadas,
  métricas/evidências mais legíveis, labels compactas e seleção clara. Aria-pressed
  para zonas/mascotes; “Snapshot carregado” descreve corretamente os dados estáticos.

Na retomada, esses sete arquivos de produção já estavam modificados, e os três
testes de `frontend/e2e/stage5b.spec.ts` estavam novos/não rastreados. Não se
recomeçou a implementação. Restavam teste interrompido, validação final e docs.
O comando exigido `npm.cmd run test:e2e -- e2e/stage5b.spec.ts` foi reexecutado:
dois casos passaram e o de câmera falhou (diferença 0,477204 no zoom de referência).
Sondagem independente mostrou que 300 ms capturavam a interpolação de entrada;
repouso e reset convergiam para o mesmo zoom 54,368932 no Canvas desktop final.
Corrigida a sincronização do teste para esperar o zoom calculado, mantendo os
asserts de posição, orientação, alvo e zoom. Também se verifica movimento em cada
mascote, em vez de só diferença do conjunto. Nenhum ajuste de produto foi necessário
nesta retomada. O primeiro runner foi encerrado após concluir seus casos, pois
permanecera no teardown com os servidores; as reexecuções reutilizaram esses
servidores e terminaram normalmente. Ao final, portas 8000/5173 sem listeners.

Validação final executada no Windows:

- `npm.cmd run test:e2e -- e2e/stage5b.spec.ts`: 3/3, 35,5 s.
- `.\.venv\Scripts\python.exe -B -m unittest discover -s tests -v`: 198 casos,
  197 aprovados, zero falhas, um skip de symlink por WinError 1314, 32,576 s.
- `npm.cmd test`: 14/14, zero skips/falhas.
- `npm.cmd exec tsc -- --noEmit`: exit 0.
- `npm.cmd run build`: exit 0; chunks JS de entrada 250,12 kB e cena lazy
  953,83 kB (gzip 78,91/253,77 kB). Sem dependências/lockfile alterados.
- `npm.cmd run test:e2e`: 24/24, 1,6 min; os 21 anteriores preservados.
- `git diff --check`: sem erros. Teste novo incluído na inspeção de whitespace.

As três regressões novas leem transformações reais da cena via Fiber instalado
(interface interna usada somente no teste, versão fixada). Cobrem cinco mascotes,
movimento reduzido, seleção HTML, foco e resets normais repetidos e Runner nos
quadros 14→15→18→14 com disponibilidade/13 minutos. Os testes anteriores cobrem
reset reduced motion por pixels, seleção no Canvas, replay completo, 2D, falhas de
API/importação/renderização/contexto, runtime validation e mensagens/retry.

Inspeção final de screenshots desktop 1440×1080 e mobile 390×844 confirmou os
cinco personagens na visão geral, mais legibilidade dos painéis, detalhes do forno,
monitores, borda luminosa e menos texto nas etiquetas. Consultados ord-1002,
evidências, cozinha, visão geral, quadro 15 e fallback 2D; sem overflow horizontal.
Sondagem adicional em Chrome confirmou 20 eventos/21 quadros/3 pedidos e fração
exata 1/3 por loadBundle, sem erros de página/console em operação normal. Erros
forçados dos testes são esperados e contidos. Three.Clock/PCFSoftShadowMap e
HTTPX/TestClient continuam emitindo avisos de dependências; não se migraram APIs.

Antes/depois: `out/stage5b-before-*.png` e `out/stage5b-after-*.png`, incluindo
desktop, evidências e mobile 3D/2D; adicionais cozinha, replay15 e desktop 2D.
Medição de 45 intervalos rAF em Chrome 156/SwiftShader, após 1,8 s: draw calls
280→308, triângulos 101.046→119.464, geometrias 178→195, texturas 12→13.
Mediana desktop 99,9→150 ms (Canvas 1016×488→1004×560); mobile 50→66,7 ms
(360×360→360×320). Com Canvas nas dimensões anteriores: 116,7/83,3 ms.
Dados brutos nos três `out/stage5b-performance-*.json`; tabela/p95 no guia.
O custo aumentou; variação de amostras e renderização por software impedem inferir
FPS de GPU. Exige revisão em dispositivo modesto real antes de prometer fluidez.

Arquivos de produção: App.tsx, RestaurantScene.tsx, SceneLabel.tsx, Monster.tsx,
Restaurant.tsx, OrderParcel.tsx e app.css. Novo teste: stage5b.spec.ts. Documentos:
README.md, CONTROL_TOWER.md e HANDOFF.md. Diff completo em `out/stage5b-review.diff`,
incluindo o arquivo não rastreado. Núcleo/API/testes anteriores, dados, hashes,
fontes, runtime IDs/Unicode, frações, fixtures e lockfile permanecem sem alterações.
Não houve alteração de contratos que exigisse novo ADR.

Limitações: labels ainda se aproximam na retirada e podem cobrir parte do Runner;
mobile depende do HTML para ler detalhes pequenos. Não houve homologação em GPU
física, telefone real, outros browsers nem auditoria completa de acessibilidade.
Fallback/reduced motion preservados. Snapshot pequeno e estático, prefixos
quadráticos e limites de publicação/concorrência continuam conforme ADRs 007/008.
Pendente somente revisão técnica/visual independente e aceite do custo gráfico;
não iniciar agentes, MCP, n8n, novo backend ou Etapa 6 nesta entrega.
