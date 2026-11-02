# Etapa 6B — Scout e exploração de incidentes

Implementada sobre a Etapa 6A aprovada no commit `af983ee`, aguardando Code Review
#008. Ponytail FULL: reutilização do executor, provedor, validação canônica e
transporte do Trace; sem dependências novas ou alteração dos cálculos do núcleo.

## Arquitetura e fronteiras de confiança

Clique do usuário → React → catálogo GET independente → POST FastAPI → Scout → três ferramentas de leitura
do snapshot → seleção pelo provedor → validação canônica → resultado navegável.
Selecionar o mascote ou alterar o replay não inicia uma análise.

`ScoutTools` lê cópias do snapshot aprovado e usa as métricas já calculadas pelo
núcleo. Antes das chamadas, fixa resultados JSON imutáveis em um catálogo privado.
O executor captura esse catálogo e compara integralmente cada retorno com ele,
incluindo textos, valores, fontes, timestamps, linhas, hashes e campos extras.
Argumentos entregues à ferramenta e eventos publicados são cópias independentes.
O catálogo não é reconstruído a partir do retorno potencialmente adulterado.
Esta proteção confia no núcleo, no snapshot e no código Python do processo;
não isola código hostil que tenha acesso arbitrário à memória do backend.

O adaptador Ollama existente está conectado, mas **Scout não foi homologado com
LLM real nesta etapa**. Todas as avaliações usam stubs/mocks rotulados. Produção
não troca automaticamente um provedor indisponível por uma resposta simulada.

O modelo escolhe a ordem das ferramentas e, no fim, até 12 IDs de alertas para
destacar e um foco `overview`, `timing` ou `evidence`. O backend valida a escolha
e associa um texto português controlado ao foco. Não há prosa factual livre do
modelo publicada como verificada. Todos os alertas canônicos continuam visíveis,
mesmo quando não destacados. Isto é seleção assistida, não diagnóstico causal.

## Contrato `scout.1`

POST `/api/v1/scout/analyze`, corpo estrito:

```json
{"snapshot_id":"<SHA-256 de 64 caracteres>","frame_index":20}
```

Antes do POST, o cliente consulta GET `/api/v1/scout/catalog?snapshot_id=<id>&frame_index=20`.
O retorno `scout.1` contém exatamente `schema_version`, `snapshot_id`, `frame_index`,
`alerts`, `thresholds` e `unknowns`. Não executa ferramentas nem provedor: lê uma
cópia do catálogo JSON fixado por `ScoutTools`, reutilizando as mesmas projeções e
regras do POST. Usa `no-store`; query extra/duplicada ou quadro inválido retorna
422, snapshot divergente retorna 409. O cliente limita essa leitura a 10 s e não
inicia o POST se ela falhar. Cancelamento e retry permanecem disponíveis.

### Fronteira do cliente após a correção #008

O stream não pode definir a própria referência de completude. O cliente captura
o catálogo GET separadamente e exige igualdade integral de alertas, textos,
thresholds e limites tanto no resultado da ferramenta quanto na conclusão. O
histórico continua sendo comparado às emissões efetivamente recebidas. Omitir,
inventar ou alterar um alerta em todas as cópias do NDJSON é rejeitado.

O catálogo GET também é conferido contra o bundle já validado: snapshot/quadro,
pedido, prefixo temporal, identidade/tipo/campo/timestamp/origens das fontes,
linhas e hashes, métricas exatas disponíveis, condição positiva/threshold com
`BigInt`, categoria e unicidade da regra. Cancelamento exige estado `CANCELLED`,
elegibilidade confiável e fontes de eventos `ORDER_CANCELLED` aplicados;
`DELIVERED`/`evt-019` não sustentam cancelamento. Limites de evidência e dados
pendentes exigem suas condições e diagnósticos correspondentes. Conflitos sem
projeção preservam a auditoria estática, sem pedido artificial. Não recalculamos
intervalos nem elegibilidade no TypeScript. Não existe campo de severidade livre
no alerta; campos extras são rejeitados e severidade diagnóstica vem do bundle.

A explicação final deve corresponder exatamente a um dos três textos controlados
do foco aceito. Prosa livre sobre culpa, responsabilidade ou métricas inventadas
não chega ao resultado confirmado. Campos padrão dos diagnósticos são preenchidos
com os modelos HTTP existentes, evitando diferenças de formato em evidências
incompletas; nenhum evento ou cálculo operacional é alterado.

**Confiança residual:** a completude e os textos factuais dos alertas dependem do
catálogo determinístico do backend local; o cliente verifica relações e valores,
não reconstrói esse gerador. Não há assinatura nem garantia criptográfica. Um
atacante que controle coordenadamente GET canônico, bundle e POST, ou o código/
memória do servidor, está fora dessa fronteira. Alteração apenas do NDJSON não
pode redefinir a referência independente. Esta API é para uso local sintético.

| Ferramenta | Retorno canônico |
| --- | --- |
| `get_operations_overview` | Agregados do quadro e eventos de contexto do prefixo |
| `get_operations_orders` | Projeções dos pedidos do quadro, com métricas e integridade |
| `get_operations_alerts` | Catálogo de alertas, threshold e limites de interpretação |

Todas recebem exatamente o snapshot e quadro fixados; campos extras, booleanos
como quadro, ferramentas desconhecidas e mudanças de escopo são rejeitados.
Não há ferramenta de escrita, caminho arbitrário, execução de texto ou chamada
autônoma ao Trace. Limites: três chamadas, quatro turnos, 120 segundos, contexto
de 64 KiB e um slot por processo **compartilhado por Scout e Trace**. O adaptador
mantém seus próprios limites de contexto/geração já existentes.

Transporte HTTP/NDJSON, não SSE: `started`, `generating`, `tool_started`,
`tool_result`, `completed` ou `error`. Cada registro mantém UUID, provedor/modelo,
modo, snapshot, quadro e duração. O histórico terminal deve corresponder
integralmente aos registros observados. O cliente valida ordem, argumentos,
resultados, fontes e escopo; não publica um resultado antes do fim válido do stream.
Há timeout, limites de bytes/eventos e cancelamento, inclusive de linhas já lidas
no mesmo buffer. Trocar pedido/quadro ou fechar painel cancela uma análise pendente;
callbacks antigos não podem substituir um novo resultado.

## Regras determinísticas

| Código | Condição comprovada | Categoria / localização lógica |
| --- | --- | --- |
| `DELIVERY_DELAY` | Atraso disponível e positivo | Atenção; sem localização atribuída |
| `KITCHEN_DELAY` | Atraso de preparo disponível e positivo | Atenção; cozinha |
| `COURIER_WAIT` | Espera concluída disponível, maior que o limite | Atenção; retirada |
| `CANCELLED` | Elegibilidade confiável de cancelamento | Informação; investigação |
| `EVIDENCE_LIMITED` | Resolução inconsistente/ambígua ou evidência incompleta | Evidência; investigação |
| `PENDING_DATA` | Pedido confiável não cancelado, com métricas indisponíveis | Informação; sem localização atribuída |
| `UNPROJECTED_CONFLICT:<id>` | Conflito sem todos os pedidos projetados, ou de contexto | Evidência; sem pedido/localização artificial |

Identidade estável: SHA-256 de snapshot, pedido, regra e, para espera, threshold.
Uma ocorrência por regra/pedido; atraso, preparo e espera são intervalos distintos.
Frações permanecem exatas, com numerador/denominador strings no HTTP. Zero não é
indisponibilidade. A independência das métricas e a elegibilidade são as do ADR-006.

O limite de espera é **demonstrativo, não calibrado**, padrão 10 minutos, inteiro
entre 0 e 120; a comparação é estrita (`espera > limite`). Configure antes de
iniciar a API: `$env:RESCUEOS_SCOUT_WAIT_MINUTES = '13'`. Nesse exemplo, espera
exatamente de 13 minutos não gera o alerta. `create_app(scout_wait_minutes=13)`
permite configuração explícita em testes. O valor usado aparece no resultado/UI.

Eventos aceitos são somente do prefixo até o quadro solicitado. Conflitos excluídos
continuam **auditoria estática do arquivo inteiro**, conforme ADR-008/Trace: não
são eventos futuros aplicados nem têm âncoras temporais inventadas. Os diagnósticos
completos preservam todas as origens, inclusive quando não há projeção de pedido.
Ausência de alerta não comprova ausência de problema; cancelamento não prova falha;
intervalos não estabelecem causa ou responsabilidade.

## Exploração visual e Trace

Na fixture final há quatro alertas: entrega 13 min, preparo 11 min e espera 13 min
de `ord-1002`, e cancelamento informativo de `ord-1003`. Espera referencia `evt-015`
(linha 15, chegada às 18:22) e `evt-018` (linha 18, coleta às 18:35), com os offsets
originais e hashes. Clique no cartão: seleciona o pedido, destaca-o com um anel
discreto e foca a zona lógica conhecida. Nenhuma geografia real é inferida.

“Ver o que aconteceu” navega ao quadro 15; os passos permitem alternar 15/18.
A análise permanece fixada no quadro 20, com aviso explícito sobre o quadro atual.
Esta exploração funciona sem novas chamadas de IA. “Abrir investigação no Trace”
seleciona o pedido e retorna ao quadro analisado, abre Trace e aguarda outro clique
em “Investigar com Trace”. É handoff pelo usuário, não colaboração autônoma.

Trace agora apresenta estado e três cartões (antecedência quando aplicável, atraso
de preparo e espera), com fontes navegáveis e aviso de causa indeterminada. A lista
integral de fatos, hipóteses, desconhecidos, fontes e hashes permanece em detalhes
recolhidos; a auditoria continua acessível. O contrato `trace.1` foi preservado.

## Demonstração segura no PowerShell — sem Ollama

Com dependências **já instaladas**, encerre uma API anterior com Ctrl+C no terminal
correto antes de abrir esta. Não execute `tests.trace_live` nesta demonstração.

```powershell
# Terminal 1: ambos os provedores são explicitamente stubs de teste
Set-Location D:\rescueos_starter
.\.venv\Scripts\python.exe -B -c "import uvicorn; from rescueos.tower.api import create_app; from tests.test_scout import ScoutStub; from tests.test_trace import StubProvider; uvicorn.run(create_app(trace_provider=StubProvider(), scout_provider=ScoutStub()), host='127.0.0.1', port=8000)"
```

```powershell
# Terminal 2
Set-Location D:\rescueos_starter\frontend
npm.cmd run dev
```

Abra http://127.0.0.1:5173/, selecione Scout, clique “Analisar restaurante” e confira
**STUB DE TESTE — não é IA real**. Explore espera → quadros 15/18 → Trace → iniciar
investigação. `?view=2d` oferece a mesma navegação sem WebGL. Teclado, mobile e
movimento reduzido são preservados. Ctrl+C encerra os dois serviços.

Um futuro teste real exige autorização separada e monitoramento HWiNFO: sem
monitoramento, pular; 80 °C não aumentar carga; 85 °C interromper, sem novas
inferências. Não há teste real ou benchmark obrigatório para aceitar esta etapa.

## Evidências visuais e limites

Capturas locais em `out/stage6b-*.png`: overview, scout-selected, analysis,
alert-open, alert-highlight, guided-replay, handoff, trace-summary, mobile,
mobile-3d e fallback, além de before-desktop/before-mobile. O cartão aberto e o destaque 3D aparecem juntos em
alert-highlight. Chrome usa SwiftShader; estas capturas não medem a RX 6600.
Inspeção desktop/mobile preserva o restaurante e evita novos rótulos flutuantes.
As etiquetas dos pedidos permanecem próximas na retirada, como no baseline 5B;
a página mobile fica longa com todos os cartões abertos. Detalhes técnicos são
recolhidos e não há overflow horizontal nas verificações automatizadas.
O hover do botão principal foi verificado no navegador com contraste observado
de 7,7:1 após ajuste da regra compartilhada. Navegação de alerta sem localização
preserva a visão geral, em vez de atribuir uma zona a partir do tipo do evento.

| Estado inspecionado | Captura local |
| --- | --- |
| Visão geral | [overview](../out/stage6b-overview.png) |
| Scout selecionado, sem execução automática | [scout-selected](../out/stage6b-scout-selected.png) |
| Análise com stub identificado | [analysis](../out/stage6b-analysis.png) |
| Alerta aberto | [alert-open](../out/stage6b-alert-open.png) |
| Pedido e região destacados | [alert-highlight](../out/stage6b-alert-highlight.png) |
| Replay no quadro 15, análise fixada em 20 | [guided-replay](../out/stage6b-guided-replay.png) |
| Handoff sem execução automática | [handoff](../out/stage6b-handoff.png) |
| Resumo Trace | [trace-summary](../out/stage6b-trace-summary.png) |
| Mobile com 3D | [mobile-3d](../out/stage6b-mobile-3d.png) |
| Mobile e fallback acessível | [mobile](../out/stage6b-mobile.png), [fallback](../out/stage6b-fallback.png) |
| Baseline anterior | [desktop](../out/stage6b-before-desktop.png), [mobile](../out/stage6b-before-mobile.png) |

Persistem auditoria efêmera, slot apenas por processo, cancelamento externo
best-effort, confiança no snapshot e ausência de persistência/distribuição.
Não se estima espera em andamento, previsão de atraso ou causalidade. Não há
Fixer/Coordinator autônomos. Antes de um simulador dinâmico serão necessários
cenários/sementes reproduzíveis, política temporal de diagnósticos, retenção de
snapshots/auditoria, limites de recursos e calibração de thresholds. Esses itens
não foram implementados nesta etapa.

## Validação original, anterior à correção #008

Na raiz, `.\.venv\Scripts\python.exe -B -m unittest discover -s tests -v`:
254 casos, **253 aprovados e um skip preexistente** de symlink/privilégio Windows.
`-m unittest tests.test_scout tests.test_trace -v`: **56/56**, incluídos no total.
Em `frontend`, `npm.cmd test`: **45/45**; `npx.cmd tsc --noEmit` e
`npm.cmd run build`: exit 0; `npx.cmd playwright test`: **33/33** na execução final.
Total sem dupla contagem: **331 aprovações e um skip**. `git diff --check`: exit 0.

A primeira execução completa teve um timeout global no teste antigo de câmera
(32 aprovações/1 falha). Isolado e nas duas execuções completas seguintes, passou
sem alteração de teste/timeout/retry. Artefatos da falha foram preservados; isto
continua uma instabilidade observada sob SwiftShader para a revisão #008.
A regressão final de navegação sem zona falhou antes e passou após a correção.
Logs, comparação do stream Trace anterior e inventário/diffs constam no HANDOFF.

## Correção #008 — resultados e reprodução

Antes da mudança, `node --test src/api/scout.test.ts` executou 22 testes:
11 aprovações e **11 falhas esperadas** por ausência de rejeição, incluindo falso
cancelamento de `ord-1001` sustentado por `evt-019`, código/categoria/texto alterados,
omissão/invenção de alerta e explicações livres com culpa/999 minutos. Dois novos
testes Python falharam com 404 no catálogo independente ainda inexistente. O teste
visual falhou com **0 pixels diferentes, ruído 0**, centro mundial y=0,075.
Logs RED preservados em `out/review008-node-red.log`, `review008-python-red.log`
e `review008-pixels-red.log`. Casos já protegidos, como severidade extra,
referências inválidas e histórico truncado, continuaram rejeitados.

Após a correção: Python **256 casos: 255 aprovações, 1 skip preexistente** de
symlink sem privilégio Windows (WinError 1314); Scout+Trace **58/58**, incluídos.
Node **63/63** (24 do Scout); TypeScript strict e Vite build exit 0;
Playwright **37/37 em 3,4 min**, sem retries/timeouts alterados. São **355
aprovações e 1 skip**, sem dupla contagem. `git diff --check`: exit 0.
As quatro regressões de navegador também passaram isoladas: 4/4 em 1,1 min.
Testes antigos de câmera passaram na suíte completa: 18,8 s (#005) e 16,4 s (5B).
Não reproduzimos a instabilidade nesta rodada e não alteramos esses testes.

O anel único contorna a face superior do pacote (local y=0,2; topo do pacote
y=0,185), com profundidade habilitada. Isso evita a posição enterrada e oclusão
total do anel inferior sem mudar o piso, personagens ou câmera. Comparações PNG
usam a região projetada do anel, diferença RGB >12 e controle adicional com duas
imagens do anel desligado; exigem mais de 8 pixels e mais de 3× o ruído.
As capturas finais têm ruído zero. Os testes cobrem câmera focada/geral, posições
PREPARING/READY/PICKED_UP, DELIVERED e seleção de CANCELLED no mobile, com
movimento reduzido. Desktop 1440×1080 e mobile 390×844, Chrome/SwiftShader;
não são medição de performance ou homologação da RX 6600.

| Evidência local | Conteúdo |
| --- | --- |
| [Antes](../out/review008-ring-before.png) / [medição](../out/review008-ring-before-pixels.json) | 0 pixels; anel sob o piso |
| [Depois focado](../out/review008-ring-focused-on.png) / [sem anel](../out/review008-ring-focused-off.png) | Diferença efetiva na região esperada |
| [Geral](../out/review008-ring-overview-on.png) | Destaque preservado na visão geral |
| [Retirada](../out/review008-ring-frame-17-on.png) | Anel acima do pacote no balcão |
| [Mobile](../out/review008-ring-mobile-on.png) / [sem anel](../out/review008-ring-mobile-off.png) | Destaque efetivamente renderizado |
| [Correções](../out/review008-corrections.diff) | Diff incremental desta rodada, incluindo arquivo novo |
| [Etapa 6B completa](../out/stage6b-after-review008.diff) | Diff contra `af983ee`, incluindo untracked |
| [Inventário](../out/review008-verification.json) | Escopo, hashes e invariantes da fixture |

Os arquivos de `out/` são artefatos locais ignorados pelo Git. Para reproduzir,
use o backend explícito com stubs descrito acima, reiniciando somente o processo
do RescueOS, e execute os comandos abaixo. Os testes HTTP/Node geram seus dados
com stubs; Playwright intercepta os POSTs de investigação. Não execute
`tests.trace_live` nem solicite inferência ao Ollama real.

```powershell
Set-Location D:\rescueos_starter
.\.venv\Scripts\python.exe -B -m unittest tests.test_scout tests.test_trace -v
.\.venv\Scripts\python.exe -B -m unittest discover -s tests -v
Set-Location frontend
node --test src/api/scout.test.ts
npm.cmd test
npx.cmd tsc --noEmit
npm.cmd run build
npx.cmd playwright test e2e/review008.spec.ts
npx.cmd playwright test
Set-Location ..
git diff --check
```

O fluxo falso falha sem apresentar resultado confirmado; uma nova tentativa com
payload válido continua concluindo com quatro alertas. Limitações anteriores
(auditoria efêmera, slot por processo, cancelamento externo best-effort, confiança
no backend) permanecem. Etiquetas/objetos podem encobrir parte do anel; não há
promessa de visibilidade sob qualquer órbita arbitrária. Aguardando segunda
revisão independente #008, sem commit/push ou avanço para 6C.
