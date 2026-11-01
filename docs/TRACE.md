# Etapa 6A — Trace: investigação local de evidências

Implementado para Code Review #007 em 2026-10-31, sobre a Etapa 5B aprovada
(`4046192`). Ponytail FULL; nenhuma dependência nova, instalação, commit ou push.
Somente Trace utiliza LLM; os outros quatro mascotes continuam demonstrativos.

**Estado após a correção #007:** retornos de ferramentas agora são conferidos
contra um catálogo independente do snapshot antes de qualquer publicação. Histórico
do cliente e teste gráfico corrigidos; aguardando reavaliação independente.
**Segurança térmica:** inferências reais são proibidas nesta rodada. Todas as
validações abaixo da correção usam stubs/mocks; não executar `tests.trace_live`.

## Arquitetura

React → POST FastAPI → TraceAgent → plano JSON do Ollama → quatro ferramentas
Python de leitura → seleção JSON de fatos pelo Ollama → verificação → NDJSON → React.

O modelo escolhe a ordem/agrupamento das ferramentas e os IDs dos fatos. O servidor
fixa pedido, snapshot e quadro; o modelo não escreve argumentos de IDs. Há duas ou
mais inferências reais e consultas Python auditadas. Não há verificação semântica
geral de prosa livre: texto, valores e fontes vêm das ferramentas; o LLM seleciona
fatos existentes. Nenhuma prosa factual arbitrária do modelo é publicada.

| Ferramenta | Leitura existente reutilizada |
| --- | --- |
| `get_order_timeline(order_id)` | Estado, resolução, qualidade e eventos aceitos do prefixo |
| `get_order_metrics(order_id)` | Métricas disponíveis com racionais e fontes; motivos de indisponibilidade |
| `get_order_evidence(order_id)` | IDs, tipos, timestamps com offset, linhas e hashes das origens |
| `get_order_diagnostics(order_id)` | Inconsistências do quadro e conflitos da ingestão que atingem o pedido |

As ferramentas leem o snapshot existente, sem recalcular negócio. Eventos aceitos
são limitados a `events[:frame_index]`. Conflitos do arquivo completo continuam
conhecidos em todos os quadros (ADR-008): auditoria estática, não eventos futuros
aceitos. Pedido ainda sem projeção recebe 404, sem pedido artificial.

Hipóteses são duas perguntas padronizadas para revisão (`kitchen_timing` e
`courier_wait`), permitidas somente com a respectiva métrica positiva disponível e
selecionada. Nunca estabelecem causa ou culpa. O schema limita essas opções e o
backend confere a resposta novamente. Ausência, ambiguidade e evidência incompleta
são preservadas; `null` não vira zero. A seleção de todos os indicadores é
solicitada e avaliada, mas não garantida para qualquer modelo.

## Modelo e execução

**Ollama 0.34.4**, modelo já instalado **qwen3:4b**, Q4_K_M (~2,5 GB). Sem pull,
pesos baixados, credenciais ou serviço pago/cloud. Adaptador HTTPX existente com
endereço fixo `127.0.0.1:11434`, sem proxy/redirect. Confere tags/metadados locais,
rejeita cloud/encaminhamento remoto; não instala nem inicia o provedor sozinho.

O experimento inicial de chamadas nativas produziu repetição/truncamento com este
modelo. A implementação final utiliza `format` JSON Schema e despacho Python
explícito. `think=false`, temperatura 0, contexto 8192, até 768 tokens por resposta.
[Contrato oficial de chat Ollama](https://docs.ollama.com/api/chat).
Temperatura zero não garante respostas ou durações idênticas.

PowerShell, somente com Ollama/modelo já instalados:

```powershell
Set-Location D:\rescueos_starter
$env:OLLAMA_HOST = '127.0.0.1:11434'
$env:OLLAMA_NO_CLOUD = '1'
$env:OLLAMA_NOPRUNE = '1'
& "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe" serve
```

Em outros dois terminais, execute API/Vite conforme [CONTROL_TOWER.md](CONTROL_TOWER.md).
Abra Trace no pedido e clique **Investigar com Trace**. Sem modelo/provedor há erro
e retry, sem troca silenciosa para stub. `RESCUEOS_TRACE_MODEL` pode escolher outro
nome já instalado antes de iniciar a API; outros modelos exigem avaliação própria.

## Contrato `trace.1`

`POST /api/v1/trace/investigate`, corpo JSON:

```json
{"order_id":"ord-1002","snapshot_id":"<SHA-256 do bundle>","frame_index":20}
```

Sem campos extras; índice inteiro, não booleano. IDs seguem `str.strip()` sem
normalização. JSON escapado preserva U+FEFF e surrogates isolados. Corpo até 16 KiB.
Erros pré-execução: 403 origem, 404 pedido, 409 snapshot, 413 tamanho, 422 contrato
ou quadro. GETs/schema 1.0 anteriores não mudaram.

HTTP 200 inicia `application/x-ndjson`, sem cache. Cada linha inclui versão,
`run_id` UUID, pedido/snapshot/quadro, provedor/modelo, modo e milissegundos reais.
Eventos: `started`, `generating`, `tool_started`, `tool_result`, `completed`, `error`.
Falha durante a execução é uma linha terminal `error`, ainda sob HTTP 200.

`completed` contém `facts`, `hypotheses`, `unknowns`, `tool_history`. Cada fato tem
ID/tipo/valor/texto e fontes (evento/tipo, campo, timestamp, origem/linha/SHA-256).
Histórico guarda ferramenta, argumentos efetivos, início/fim, resultado ou erro.
Não guarda prompts, chain of thought ou saída bruta do modelo. O cliente valida
escopo/sequência/ferramentas/fontes e compara fatos finais aos resultados recebidos.
Modo `test` é explícito na UI e só existe por injeção em testes, nunca por HTTP ou
configuração. O histórico é efêmero; repetir/trocar pedido/recarregar o descarta.

O replay não é alterado para investigar. O quadro fica congelado na solicitação;
navegação posterior mostra aviso de contexto antigo. Clicar em fonte usa a busca
temporal existente. Trocar pedido desmonta/aborta o painel. Cancelar aborta fetch
e não apresenta conclusão.

## Segurança e orçamento

- Whitelist de quatro funções sem shell, arquivos, rede, escrita ou ações para o
  modelo. Escopo independe de suas instruções. Payload arbitrário de `data` não é
  enviado. IDs/resultados são dados não confiáveis. A proteção principal é validar
  plano e selecionar apenas fatos canônicos, além das instruções ao modelo.
- Quatro chamadas sem repetição; cinco turnos; 120 s por execução, timeout HTTPX
  60 s, cliente 125 s. Um slot por processo; concorrente recebe `BUSY`, sem fila.
- Resposta Ollama até 256 KiB, mensagens/ferramenta até 64 KiB; cliente até 1 MiB
  e 32 eventos. Excesso encerra com erro, sem falsa conclusão parcial verificada.
- Códigos seguros para modelo/ferramenta indisponível, limites, timeout, referência
  inventada, falta de evidência e hipótese indevida. Exceções internas não são
  refletidas. Não há persistência do agente nem escrita de negócio.
- Origem browser conferida (dev 5173, preview 4173 ou API 8000, somente loopback)
  e CORS local não são autenticação. Clientes sem Origin
  e processos locais podem chamar a API. Usar somente local com dados sintéticos;
  não expor API/Vite/Ollama publicamente. Sem quota global ou coordenação multiworker.
- Cancelamento libera o slot/interrompe a espera; não garante parada imediata do
  cálculo já iniciado no processo externo Ollama.

## Avaliações executadas

```powershell
Set-Location D:\rescueos_starter
.\.venv\Scripts\python.exe -B -m unittest tests.test_trace -v
.\.venv\Scripts\python.exe -B -m unittest discover -s tests -v
# Não executar tests.trace_live nesta rodada: restrição térmica, somente mocks.
Set-Location frontend
npm.cmd test
npm.cmd exec tsc -- --noEmit
npm.cmd run build
npm.cmd run test:e2e
Set-Location ..
git diff --check
```

23 testes Python novos cobrem fixture, prefixo incompleto, conflitos, ambiguidade,
IDs especiais, pedido inexistente, ferramenta/modelo indisponível, referências
inventadas, falta de evidência, injection, hipóteses indevidas, limites, timeout,
concorrência, cancelamento e HTTP. Stub testa decisões inválidas, não inteligência.
Cinco testes Node cobrem stream dividido/Unicode, referências/claims, escopo/ordem,
truncamento, erro e limpeza/cancelamento. Três Playwright cobrem integração 3D,
fontes clicáveis, erro/retry, cancelamento e escopo temporal.

Registro histórico do implementador, anterior à correção #007, sem stub,
`out/trace-live.json` (não reexecutado nesta rodada):

| Pedido | Tempo observado | Fatos iguais aos das ferramentas | Estado + métricas disponíveis cobertos |
| --- | --- | --- | --- |
| ord-1001 | 22.724 ms | 13/13 | 6/6 |
| ord-1002 | 18.197 ms | 13/13 | 6/6 |
| ord-1003 | 7.978 ms | 4/4 | 1/1 |

Medidas de igualdade de fatos/fontes e cobertura nesta fixture, não uma nota geral
de raciocínio causal. O primeiro ensaio rejeitou hipóteses indevidas em ord-1001/1003;
após restringir o schema às métricas positivas, todos concluíram sem relaxar a validação.

No Chrome/Windows real, ord-1002 concluiu em 8.768 ms no agente (14.477 ms até a
captura desktop), com 13 fatos, quatro ferramentas,
`mode=llm`, sem erro de página. Entrega 13: `evt-004/data.promised_delivery_at` →
`evt-020/occurred_at`; cozinha 11: `evt-004/data.promised_ready_at` → `evt-017/occurred_at`;
espera 13: `evt-015/occurred_at` → `evt-018/occurred_at`, linhas 15/18.
Nenhuma causa/responsabilidade estabelecida. Artefatos locais ignorados:
`out/trace-browser-real.json`, `out/trace-real-desktop.png`, `out/trace-real-mobile.png`.
Capturas inspecionadas em 1440×1080 e 390×844, sem overflow horizontal. Painel longo
usa rolagem existente. Chrome com SwiftShader não certifica FPS/GPU. Ollama avisou
sobre driver AMD antigo; desempenho de inferência em GPU não foi homologado.

Validação histórica anterior à correção #007: Python 221 casos, 220 aprovados, um skip preexistente de symlink
WinError 1314. Node 19/19; strict/build exit 0; Playwright final 27/27, exit 0.
A primeira execução completa teve duas falhas gráficas intermitentes em testes
anteriores (animação em janela fixa e mensagem de contexto WebGL); ambos passaram
isoladamente e na repetição completa, sem alterar cena ou testes antigos.
`git diff --check` sem erros; detalhes e logs no HANDOFF.
Limitações: fixture pequena, hipóteses restritas, sem inferência causal verificada,
auditoria efêmera e provedor local sem gestão de jobs. Antes de produção, avaliar
autenticação, quotas, retenção, isolamento de dados/modelo e cancelamento externo.
Sem MCP/outros agentes. Aguardar Code Review #007.

## Correção #007 — catálogo confiável, stream e observação gráfica

O catálogo canônico é montado na criação de `OrderTools`, diretamente das cópias
do snapshot aprovado e do quadro selecionado. `_read` somente formata as projeções
existentes: não recalcula atrasos, elegibilidade, taxas ou estados. Guarda o resultado
completo de cada ferramenta como JSON em `MappingProxyType`: strings imutáveis,
independentes de qualquer resposta de `call`. Pedido/snapshot/quadro ficam no request
congelado, sem setter público. O catálogo é anterior ao provedor e às chamadas.

Cada chamada retorna uma nova desserialização. O agente captura o catálogo e compara
a resposta inteira com ele **antes** de emitir `tool_result` ou enviá-la ao modelo.
A comparação inclui fatos/IDs/tipos, valores racionais exatos, texto, campos,
timestamps, fontes, origens, linhas, hashes, lacunas e diagnósticos. Campos extras,
omissões, fatos de outro pedido ou indisponíveis no quadro também divergem. Ordem
de chaves de objetos é indiferente; arrays seguem a ordem canônica do núcleo.
O vínculo semântico vem da projeção confiável que define cada fato e suas fontes,
não da mera existência do ID no retorno da ferramenta.

Divergência gera `TOOL_RESULT_MISMATCH`, sem resultado adulterado no stream, no
histórico ou no prompt. O erro auditável preserva ferramenta, argumentos efetivos,
início/fim, escopo e código, sem refletir conteúdo não confiável. Após igualdade
confirmada, o agente desserializa outra cópia do catálogo, impedindo que uma
ferramenta altere depois um objeto retornado. Não corrige silenciosamente respostas
divergentes. A confiança termina no snapshot/código do núcleo; não há proteção
contra execução arbitrária dentro do próprio processo ou comprometimento do SO.

O cliente acompanha uma chamada ativa por vez. `started_ms` coincide exatamente
com o `elapsed_ms` de `tool_started`; argumentos, nome e resultado devem corresponder
à chamada ativa. `ended_ms` é obrigatório no resultado e não supera o tempo do
evento. O histórico terminal é comparado integralmente, em ordem, com os registros
observados. Em erro com chamada pendente, somente o encerramento com código igual
ao erro terminal é permitido, sem resultado inventado. Históricos duplicados,
alterados, omitidos ou reordenados são rejeitados.

Métricas exigem `{numerator: string, denominator: string}` com inteiros decimais e
denominador positivo, sem campos adicionais. Reutiliza-se o validador existente;
nenhuma conversão para float. Hipóteses exigem sua métrica positiva selecionada:
`kitchen_timing` → `metric.kitchen_delay`; `courier_wait` →
`metric.courier_waiting_time`. Fatos `state` não sustentam essas hipóteses.

O teste dos mascotes agora observa mudanças reais nas transformações com prazo de
10 s, sem depender de uma fase do ciclo. Após reduced motion, aguarda avanço de
frames reais antes de comparar estabilidade; não usa sleeps maiores nem retries.
Cena, geometria e animações não precisaram de alterações.

Provas RED antes de mudar produção: cinco testes Python, 19 falhas de asserção
incluindo subtestes; o ataque `999/1` era publicado. Node: 24 casos, oito aprovados
e 16 falhas. Logs `out/review007-python-red.log`, `out/review007-node-red.log`.
Depois: ataque bloqueado com `TOOL_RESULT_MISMATCH`; cobertura de valor/texto/tipo,
campo/evento/timestamp, origem/linha/hash, fontes incompletas, fato inexistente,
outro pedido/quadro, dados extras, diagnóstico adulterado e mutação tardia.
Controle válido preserva exatamente `1/3` e aceita reordenação de chaves.
Resultados completos e comandos executados constam no HANDOFF.

O formato `trace.1` foi endurecido antes da aprovação; sem novo endpoint ou alteração
dos GETs/schema 1.0 do negócio. Streams históricos com inconsistências de timestamp
ou histórico podem ser recusados; não há auditoria persistida para migrar. As provas
anteriores de LLM são históricas, não homologação da versão corrigida. Reavaliação
deve continuar com mocks; um eventual teste real futuro exige autorização específica
e monitoramento térmico, conforme instruções do usuário. Nenhuma inferência real,
benchmark de tokens, instalação, mudança de hardware, commit ou push nesta rodada.

Validação final desta correção: Python 227 casos (226 aprovados, um skip anterior),
Trace 29/29 incluídos no total, Node 38/38 (24 no arquivo Trace), strict/build exit 0,
Playwright 27/27 em 1,8 min e mascotes isolado 1/1. Total: **291 aprovações e um skip**.
Sondagem navegador/cliente com o stream real do agente e provedor stub: `999/1`
terminou em `TOOL_RESULT_MISMATCH`, sem resultado verificado nem valor adulterado
na auditoria; retry válido concluiu, sem erro de página. Captura local ignorada
`out/review007-blocked.png`. Reiniciar a API após atualizar o código; Vite HMR não
recarrega os módulos Python de um processo Uvicorn já em execução.

## Correção #007, rodada 2 — isolamento da auditoria

A segunda revisão encontrou alias de `args`: chamada da ferramenta, evento inicial
e histórico apontavam para o mesmo dicionário. Uma ferramenta que alterasse esse
objeto, imediatamente ou em outra chamada, poderia produzir `completed` com IDs
contraditórios no histórico. O cliente rejeitava o stream, mas o backend já havia
emitido uma auditoria incorreta.

O agente agora passa `args.copy()` à ferramenta e mantém os argumentos autorizados
no registro privado criado antes da execução. O contrato permite somente
`{"order_id": string}`; strings são imutáveis, e objetos/listas ou argumentos extras
continuam proibidos. Se esse contrato ganhar estruturas aninhadas, a cópia de
entrada deverá ser revista. Alterar o ID antes da validação real da ferramenta
continua gerando `TOOL_NOT_ALLOWED`, com o ID original preservado na auditoria.

Cada evento é emitido com `deepcopy`, isolando também resultados, fontes aninhadas,
histórico e payload terminal dos objetos internos e das outras emissões. Não há
reescrita de registros depois da chamada. O catálogo canônico e suas comparações
permanecem intactos; os argumentos entregues têm os mesmos valores dos registrados.
O transporte continua HTTP/NDJSON e o contrato `trace.1` não mudou.

Provas RED: seis casos Python, seis falhas de asserção contando os dois subcasos
HTTP; o controle de argumentos estruturados proibidos passou. A integração Node
com os streams HTTP reais falhou com erro de schema. Depois da correção: Trace
35/35, Python 233 casos (232 aprovados e um skip anterior), Node 39/39, strict/build
exit 0 e Playwright 27/27, totalizando 298 aprovações e um skip. Com relógio/UUID
fixados, os 13 eventos do fluxo válido anterior e posterior são idênticos byte a
byte. Chrome aceitou os dois streams corrigidos e rejeitou histórico contraditório,
sem erro de página. Logs e diffs desta rodada constam no HANDOFF.

Somente stubs/mocks foram usados; nenhuma inferência Ollama, instalação ou mudança
de hardware. Persistem as fronteiras de confiança e limitações locais anteriores.
Correção implementada, aguardando terceira revisão independente; sem commit/6B.
