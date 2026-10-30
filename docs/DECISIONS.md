# Registro de decisões (ADRs simples)

## ADR-001 — Um único produto com três módulos
**Decisão:** combinar SurgeShield, RescueOps e FairTrace em torno de um único log de eventos.
**Motivo:** facilita rastrear causas propostas, decisões e resultados sem duplicar dados.
**Alternativa descartada:** construir três aplicativos independentes.

## ADR-002 — Core determinístico primeiro
**Decisão:** validar eventos, calcular atrasos e reconstruir status sem LLM no MVP 0.
**Motivo:** resultados exatos, reproduzíveis e verificáveis antes de acrescentar agentes.
**Alternativa descartada:** pedir a um LLM que calcule métricas diretamente dos textos dos eventos.

## ADR-003 — Dados sintéticos e intervenção somente em simulador
**Decisão:** nenhuma integração oficial nem ação em pedidos reais no laboratório.
**Motivo:** segurança, privacidade, verificabilidade e ausência de acesso autorizado a dados internos.
**Alternativa descartada:** usar dados de clientes ou endpoints não autorizados.

## ADR-004 — Ingestão v0.1 e separação de diagnóstico
**Decisão nesta etapa:** o conjunto `events` contém somente eventos válidos únicos.
Reenvios idênticos podem acrescentar origens e diagnósticos, sem alterar esse conjunto.
Resultados futuros de negócio deverão depender somente de `events`; o teste atual
comprova essa fronteira, sem afirmar que estados ou relatórios já existem.

**Identidade:** JSON canônico com chaves ordenadas, incluindo campos adicionais.
Espaços e ordem de propriedades não contam como diferença. Tipos JSON são
preservados (`true`, `1` e `1.0` diferem); strings de timestamps não são normalizadas.
Dois offsets representando o mesmo instante, com strings diferentes, conflitam
quando associados ao mesmo ID. A comparação de números fracionários usa
`Decimal` e uma árvore tipada, sem arredondamento; zeros decimais finais não
alteram a identidade. Os valores aceitos em `events` são convertidos para `int`
ou `float`; a identidade decimal é calculada antes do arredondamento para float.
Campos numéricos específicos do contrato atual são somente inteiros.

**Conflitos:** comparar todos os objetos com ID string não vazio, inclusive os
inválidos. Conteúdos divergentes produzem um `EVENT_ID_CONFLICT` por ID e excluem
todas as variantes. Preservar arquivo, linha e texto de todas as ocorrências,
incluindo repetições. Informar pedidos/tipos afetados e possível indisponibilidade
de métricas futuras. JSON ilegível ou com chaves repetidas não fornece ID confiável.

**Contrato operacional:** campos do envelope são obrigatórios; IDs são strings
não vazias. `order_id` pode ser null somente nos tipos de restaurante. `data` é
objeto; criação exige os dois prazos; capacidade exige inteiros não negativos
(`bool` não é aceito); promoção exige `promotion_id` e `source` não vazios.
Motivo e verificação do cancelamento são opcionais, mas tipados quando presentes.
Demais eventos aceitam `data: {}`. Campos adicionais são preservados como dados.
Essas exigências de `data` detalham a fixture; confirmar sua manutenção na revisão.

**Tempo:** perfil `YYYY-MM-DDTHH:MM:SS[.ffffff](Z|±HH:MM)`, com calendário válido.
Rejeitar ausência de offset e `-00:00` (offset desconhecido). Não normalizar nem
calcular tempos nesta etapa. Precisão máxima de seis casas fracionárias.

**Pendências para revisão:** confirmar campos obrigatórios de `data` e perfil de
timestamp antes de ampliar o contrato. A sinalização de impacto é por pedido e
tipo de evento; a associação a métricas específicas pertence à etapa de métricas.

### Correção da Code Review #001 — limites numéricos

O decoder primeiro valida a sintaxe JSON e preserva os literais numéricos como
tokens internos, sem converter expoentes ou inteiros grandes. Somente após a
leitura completa do objeto são feitas validação numérica, identidade e conversão.
Não extrair IDs por regex. JSON malformado, constantes não JSON (`NaN`/`Infinity`),
chaves repetidas e falhas estruturais de profundidade não fornecem ID confiável.

Limites locais para todo número, inclusive em campos adicionais e arrays:

- Literal de no máximo 128 caracteres, incluindo sinal, ponto e expoente.
- Inteiros em `[-9223372036854775808, 9223372036854775807]` (signed int64).
- Decimais com no máximo 100 dígitos no coeficiente (incluindo zeros).
- Expoente explícito entre -308 e 308, inclusive para zero.
- Conversão final para float deve ser finita e não transformar valor não zero
  em zero. Arredondamento normal e valores subnormais não zero são permitidos.

São limites conservadores para dados sintéticos locais; não pretendem aceitar
todo número permitido pela gramática JSON. O limite de tamanho é checado antes
de converter expoentes; não alterar contexto global de `Decimal` nem limites
globais do Python. Conversões capturam `DecimalException`, `ValueError` e
`OverflowError`, mantendo a continuidade da leitura.

`INVALID_JSON` indica falha de sintaxe ou estrutura; `INVALID_NUMBER` indica
literal JSON sintaticamente válido fora dos limites acima. O diagnóstico numérico
inclui caminho, ID identificável e origem. Linhas com erro numérico não recebem
validações de contrato adicionais em cascata; nunca entram no conjunto aceito.

Mesmo com erro numérico, o objeto com ID string não vazio participa do agrupamento.
Tokens inválidos têm identidade tipada baseada no literal original. Variantes
divergentes, válidas ou inválidas, geram `EVENT_ID_CONFLICT`, excluindo todas e
preservando origens, pedidos e tipos afetados. Literais inválidos escritos de
formas diferentes são tratados conservadoramente como divergentes, sem tentar
normalizar números fora dos limites. Repetições inválidas idênticas permanecem
rejeitadas com diagnósticos por ocorrência, sem `DUPLICATE_EVENT` de evento aceito.

Os limites numéricos não limitam tamanho de linha/arquivo, quantidade de registros
ou volume total de texto; o consumo de memória permanece uma limitação real.

## ADR-005 — Replay v0.1 e estados observados

**Decisão da Etapa 2:** `replay(IngestResult)` consome somente `events` aceitos,
sem repetir validação, conversão numérica ou deduplicação da Etapa 1. A entrada
deve ser o resultado íntegro da ingestão; construir/modificar manualmente esse
objeto está fora do contrato. Erros da ingestão são mantidos em `ingestion_errors`,
com associação de conflitos a históricos existentes por `affected_order_ids`.
Não reinserir eventos rejeitados nem criar pedidos apenas a partir de diagnósticos.

Ordenação global pelo instante UTC de `occurred_at`, depois `event_id` (ordem
lexicográfica). A implementação usa diferença aware para uma época UTC, com
precisão de microssegundos, sem depender de timezone da máquina nem converter
para float. Isso também admite datas nos extremos do calendário aceito pela
ingestão sem overflow na normalização. Os timestamps originais são preservados.

### Transições adotadas

A documentação inicial definia terminais, mas não a matriz intermediária completa.
Este ADR explicita a política conservadora da implementação, sujeita à revisão.
`status` é o último estado aplicado com evidência, não uma estimativa do que ocorreu
em etapas sem eventos. Não sintetizar marcos, horários nem motivos.

| Evento | Pré-requisitos observados e aplicados | Efeito em status |
|---|---|---|
| ORDER_CREATED | Primeira criação na ordem determinística | CREATED |
| KITCHEN_STARTED | Criação anterior | PREPARING |
| KITCHEN_READY | Criação e KITCHEN_STARTED | READY |
| COURIER_ASSIGNED | Criação anterior | Mantém status |
| COURIER_ARRIVED | Criação e COURIER_ASSIGNED | Mantém status |
| PICKED_UP | Criação, KITCHEN_READY e COURIER_ARRIVED | PICKED_UP |
| DELIVERED | Criação e PICKED_UP | DELIVERED, terminal |
| ORDER_CANCELLED | Criação, em qualquer fase não terminal | CANCELLED, terminal |

Preparo e chegada do entregador são progressos independentes: a chegada pode
anteceder a comida pronta. Atrasos de chegada na entrada não importam; a ordem
aplicada é a dos eventos. Um marco sem pré-requisito gera `MISSING_PREREQUISITE`
e fica na timeline sem alterar o estado, inclusive uma entrega sem coleta.
Não corrigir retroativamente esse marco quando um pré-requisito ocorrer depois
na cronologia. Um novo evento posterior pode satisfazer as transições.

### Integridade e ambiguidade

- Sem nenhuma criação aceita: preservar timeline em `orphan_histories` e registrar
  `ORDER_NOT_CREATED` por evento; não inserir pedido em `orders`.
- Com criação posterior: eventos anteriores geram `EVENT_BEFORE_CREATION` e não
  alteram o estado. Em timestamps empatados, o desempate por ID também se aplica
  à precedência da criação; não pressupor simultaneidade causal.
- Criações com IDs distintos: comparar restaurante, instante de criação e os dois
  prazos (normalizados por instante UTC). Igualdade desses campos gera
  `MULTIPLE_CREATIONS`; aplicar só a primeira. Diferença gera
  `INCOMPATIBLE_CREATIONS` e ambiguidade. Campos adicionais de criação são
  preservados, mas não definem compatibilidade nem alteram prazos.
- Restaurante diferente da primeira criação: `RESTAURANT_MISMATCH`, ignorar o
  evento na redução e marcar ambiguidade. `restaurant_id` projetado fica `None`
  quando há mais de um restaurante no histórico; manter os valores nas evidências.
- Marco já aplicado, com outro ID: `REPEATED_MILESTONE`; não regredir o estado nem
  substituir o primeiro timestamp. Reenvios do mesmo ID já foram tratados na ingestão.
- Qualquer evento de pedido posterior a um terminal aplicado gera
  `EVENT_AFTER_TERMINAL`; fica na timeline, mas não altera o estado.
- Afirmações de entrega e cancelamento posteriores à criação de referência, no
  mesmo restaurante, geram `CONFLICTING_TERMINALS` e ambiguidade, mesmo se uma
  afirmação não puder ser aplicada por falta de pré-requisito. Não escolher o
  último terminal nem inferir estorno, reabertura ou causa.

`resolution` é metadado de integridade, separado de `status`:

- `CONSISTENT`: nenhuma inconsistência observada; não garante histórico completo.
- `INCOMPLETE`: sequência aceita consistente, mas há exclusões conhecidas por
  conflitos associados ao pedido. Preservar `status` e seus IDs de evidência,
  qualificando a confiabilidade da conclusão.
- `INCONSISTENT`: histórico contém eventos não aplicados ou marcos redundantes,
  mas conserva um último estado inequívoco sob as regras acima.
- `AMBIGUOUS`: `status=None` e `status_event_ids=()`; não publicar um vencedor.
  `applied_event_ids` preserva a redução de referência para auditoria, não resolve
  a ambiguidade nem autoriza métricas baseadas em um suposto estado final.

### Evidências e contexto

Cada timeline contém todos os eventos de pedido aceitos, inclusive incoerentes.
`Evidence` preserva o objeto original e todas as origens de ingestão; cada
inconsistência referencia essas evidências. `applied_event_ids` distingue os
eventos aplicados; `status_event_ids` identifica o marco do último estado inequívoco.
O resultado é uma cópia dos eventos: não modifica nem compartilha dicionários
com a ingestão. Os dicionários do resultado continuam mutáveis pelo chamador.

Capacidade e promoção são classificados por tipo em `operational_context`,
ordenados globalmente e com origens, inclusive quando trazem `order_id` preenchido.
Não participam da máquina de estados nem criam pedidos. Não inferir causalidade
entre esses eventos e atrasos/cancelamentos.

A igualdade das projeções exclui origens e `ingestion_errors`, pois linhas e
diagnósticos variam com reordenação e reenvios. Essa auditoria permanece acessível;
não prometer igualdade byte a byte de objetos que incluam essas informações.
Não há cálculo de métricas, exportação, efeitos externos ou estado persistido.

### Correção da Code Review #002 — estado e qualidade separados

`status`, `status_event_ids` e `applied_event_ids` continuam derivados exclusivamente
dos eventos aceitos. A integridade passa a incorporar exclusões conhecidas:

- `evidence_quality='NO_LINKED_CONFLICTS'`: não há conflito de ingestão associado
  ao pedido. Não afirma que o histórico esteja completo nem que toda evidência
  seja válida. Outros erros da ingestão continuam disponíveis globalmente.
- `evidence_quality='INCOMPLETE'`: há conflito associado ao pedido; também usado
  em históricos órfãos, que não possuem criação aceita.
- `ingestion_conflicts`: diagnósticos `EVENT_ID_CONFLICT` originais, associados
  por todos os `affected_order_ids`, ordenados por `event_id`. Preservam IDs,
  tipos afetados, arquivo, linha e texto original de todas as variantes, com seus
  timestamps. Não converter os textos rejeitados novamente em eventos de replay.

`resolution` resume os dois aspectos, com prioridade
`AMBIGUOUS > INCONSISTENT > INCOMPLETE > CONSISTENT`. Um conflito não transforma
uma sequência aceita em transição inválida nem em terminal contraditório.
Assim, uma entrega aceita pode permanecer `status='DELIVERED'`, mas sua conclusão
fica qualificada por `resolution='INCOMPLETE'`. Se a sequência já era inconsistente
ou ambígua, essa classificação permanece, junto de `evidence_quality='INCOMPLETE'`.

`inconsistencies` continua descrevendo apenas problemas de replay da sequência
aceita; conflitos ficam separadamente em `ingestion_conflicts`. Consumidores devem
consultar resolução e qualidade, não apenas a contagem de inconsistências.
Se não houver eventos aceitos para formar sequer um histórico, manter o conflito
em `ReplayResult.ingestion_errors`, sem criar pedido ou histórico artificial.
Históricos órfãos existentes também recebem seus conflitos associados.

A igualdade ignora o conteúdo de auditoria de `ingestion_conflicts`, cujas origens
variam com reordenação e reenvios. `evidence_quality` e a resolução qualificada
participam da igualdade; exclusões conhecidas não ficam ocultas na projeção.

Violações simultâneas são cumulativas: um evento de outro restaurante posterior
a um terminal aplicado recebe tanto `RESTAURANT_MISMATCH` quanto
`EVENT_AFTER_TERMINAL` antes de ser ignorado. Não aplicar o evento ao estado.

Limites: a associação usa os IDs de pedido informados pela ingestão, sem inferir
vínculos de erros sem `affected_order_ids`. As políticas existentes para eventos
anteriores à criação e a persistência em memória não foram alteradas nesta correção.

## ADR-006 — Métricas exatas, dependências e denominadores (Etapa 3)

**Interface:** `compute_metrics(ReplayResult) -> MetricsResult` em
`rescueos/metrics.py`. Recebe o resultado íntegro do replay, sem refatorar as
Etapas 1/2, executar textos ou reinterpretar eventos rejeitados. Não há I/O,
exportador, janela temporal, predição ou inferência de responsabilidade.

### Aritmética e contrato

Timestamps originais com offset são preservados; a subtração de datetimes aware
compara instantes UTC. Diferenças são convertidas de microssegundos inteiros
para `Fraction(microseconds, 60_000_000)`, sem truncar ou arredondar minutos.
Valores individuais e taxas são `fractions.Fraction`, contagens são `int` e
indisponibilidade usa `None`. `available` deriva de `value is not None`.
Zero é um resultado válido. Taxas têm unidade `ratio`, de 0 a 1; 1/2 equivale
a 50%, e 1/3 permanece exato. Uma apresentação decimal futura precisará declarar
seu arredondamento; Fraction não é serializado diretamente pelo JSON padrão.

Cada `Metric` contém nome, valor, unidade, motivo da indisponibilidade, fórmula,
fontes (`event_id`, tipo, campo, timestamp original e origens), IDs de apoio da
cadeia aplicada, qualidade das dependências e metadados originais de integridade
do pedido. Conflitos/questões relevantes permanecem acessíveis separadamente.
Os dados de entrada são copiados, sem mutação ou compartilhamento de dicionários.
O resultado contém dicionários mutáveis, como o replay.

### Cálculos e dependências

Selecionar somente marcos presentes em `applied_event_ids`, preservando as
escolhas do replay. Não procurar uma alternativa rejeitada para completar tempos.

| Métrica | Fontes aritméticas | Dependências de validade |
|---|---|---|
| delivery_deviation | Entrega menos prazo de entrega, em minutos | Criação, preparo, entregador, coleta, entrega e classificação terminal |
| delivery_delay | max(0, delivery_deviation) | As mesmas de delivery_deviation |
| delivery_earliness | max(0, -delivery_deviation) | As mesmas de delivery_deviation |
| kitchen_delay | max(0, cozinha pronta menos prazo de preparo) | Criação, início e finalização da cozinha |
| courier_waiting_time | Coleta menos chegada do entregador | Criação, preparo, atribuição/chegada do entregador e coleta |

A cadeia transitiva de pré-requisitos do replay integra a avaliação de validade,
mesmo quando apenas dois timestamps entram na subtração. Atraso de entrega exige
estado DELIVERED confiável. Cancelados e pedidos ainda não entregues não recebem
atraso zero por ausência de entrega. Cozinha/espera podem permanecer disponíveis
em um cancelado se seus marcos anteriores foram aplicados e são confiáveis.
Espera negativa é indisponível; não aplicar max(0, espera) para ocultar o problema.

Conflitos são relevantes por interseção de `affected_event_types` com as
dependências. Incompatibilidade de criações ou divergência de restaurante bloqueia
todas as métricas do pedido. Contradição entre terminais bloqueia entrega e
classificação do desfecho; não apaga fatos anteriores de cozinha/coleta.
Nos demais problemas do replay, avaliar o evento problemático, não a criação ou
terminal citados apenas como âncora de contexto. Marcos repetidos e pré-requisitos
ausentes relevantes bloqueiam as dependências; criações redundantes compatíveis
mantêm os valores calculáveis a partir da criação aplicada.

Qualidade local: `SUFFICIENT`, `AMBIGUOUS`, `INCONSISTENT`, `INCOMPLETE`,
`INSUFFICIENT` ou `NOT_APPLICABLE`. As três últimas distinguem conflito conhecido,
fonte ausente e ausência de entrega. `reason` identifica o impedimento; `conflicts`
e `issues` preservam todas as causas relevantes mesmo quando há uma causa prioritária.
`order_resolution` e `order_evidence_quality` continuam visíveis, inclusive quando
uma métrica local é calculável em pedido globalmente INCONSISTENT/INCOMPLETE/AMBIGUOUS.
SUFFICIENT se refere às dependências verificadas, não à completude universal.

### Agregados e populações

Todas as contagens referem-se a pedidos distintos elegíveis no snapshot completo
do replay. Contagens de populações vazias valem zero; taxas com denominador zero
são indisponíveis (`ZERO_DENOMINATOR`).

| Agregado | Inclusão |
|---|---|
| total_created | Criação aplicada, sem ambiguidade de identidade ou conflito/problema relevante de criação |
| total_delivered | Estado DELIVERED, cadeia aplicada e classificação terminal confiáveis |
| total_cancelled | Estado CANCELLED, criação e classificação terminal confiáveis |
| total_late_deliveries | Entregues com desvio disponível e desvio > 0 |
| total_on_time_deliveries | Entregues com desvio disponível e desvio <= 0 |
| delay_rate | Numerador: entregas atrasadas elegíveis; denominador: entregas com desvio disponível |
| cancellation_rate | Numerador: cancelados elegíveis; denominador: criados com classificação atual confiável, inclusive não terminais |

A taxa de cancelamento é do snapshot, não uma previsão do resultado final dos
pedidos abertos. Criação inequívoca pode contar em total_created mesmo quando o
desfecho é ambíguo; esse pedido fica excluído do denominador da taxa de cancelamento.
O denominador não deve ser substituído automaticamente por total_created.

Cada agregado registra critérios, fórmula, IDs incluídos, exclusões com motivo e
referências `(order_id, event_id)` aos eventos de apoio no ReplayResult. Taxas
registram também numerador/denominador e seus IDs. Nas contagens por sinal de desvio,
as referências abrangem a população avaliada, incluindo entregas que não satisfazem
o sinal, para permitir reproduzir a classificação.

Na classificação das populações de entrega, primeiro verificar criação aplicada,
identidade e desfecho com as dependências ORDER_CREATED, DELIVERED e ORDER_CANCELLED.
Conflitos ou inconsistências relevantes nessa etapa impedem classificar o pedido
como simplesmente não entregue, mesmo quando o estado aceito seja CANCELLED.
Com classificação confiável, um estado diferente de DELIVERED recebe NOT_DELIVERED;
somente para entregues avaliar a cadeia transitiva e, para taxas/contagens por atraso,
a disponibilidade do desvio. Problemas independentes de entregador em cancelados
não comprometem a população de entregas. Pedidos abertos são não entregues no
snapshot atual; isso não prevê seu desfecho futuro.

Essa classificação não altera métricas individuais: suas dependências, motivos,
conflitos, inconsistências e qualidade original do pedido continuam preservados.
Os IDs de apoio de uma exclusão normal referem-se à criação e ao desfecho aplicado.

Nos agregados, `COMPLETE` substitui SUFFICIENT para indicar classificação sem
incertezas relevantes conhecidas no snapshot, sem garantir completude universal.
`PARTIAL` sinaliza exclusões por incerteza; filtros normais de classe, como
NOT_DELIVERED para um cancelado confiável, não tornam a população parcial.
Disponibilidade e qualidade são independentes: uma população conhecida vazia pode
ser COMPLETE com taxa None, ZERO_DENOMINATOR e numerador/denominador 0/0; exclusões
incertas mantêm PARTIAL mesmo sem denominador. A qualidade local das métricas
individuais permanece com o vocabulário anterior, incluindo SUFFICIENT.
Zero de uma população parcial é contagem elegível observada, não prova de que
nenhum pedido real/sintético tenha ocorrido. Não converter parcialidade em ganho.

Históricos órfãos e IDs conhecidos apenas por diagnósticos ficam em
`excluded_histories`, com ORDER_NOT_CREATED ou NO_ACCEPTED_HISTORY, e nas exclusões
dos agregados. Não criam objetos OrderMetrics nem entram nos denominadores.
`diagnostic_order_ids` e `ingestion_errors` mantêm os vínculos que não possuem
histórico aceito. Erros sem ID de pedido identificável não permitem enumerar os
pedidos desconhecidos; os diagnósticos globais continuam disponíveis.

### Determinismo e limites para revisão

A igualdade ignora origens de linha e conteúdo de auditoria dos conflitos/erros,
que variam com reordenação e reenvios; fontes, valores, fórmulas, qualidade,
eventos de apoio e exclusões participam da comparação. Sem relógio ou aleatoriedade.
Políticas de dependência e denominadores deste ADR precisam de revisão funcional.
A avaliação de conflitos é por tipo de evento, conservadora: não libera uma métrica
porque duas variantes rejeitadas parecem compartilhar o mesmo campo numérico.
Escopo local em memória; sem métricas causais, financeiras, exportadores ou serviços.

## ADR-007 — Reporting & CLI determinísticos (Etapa 4)

**Integração:** `python -m rescueos --input PATH --output-dir DIR` chama
`read_jsonl -> replay -> compute_metrics -> build_reports -> write_reports`.
Nenhum cálculo, validação de eventos ou regra de elegibilidade é duplicado.
As três interfaces anteriores permanecem intactas. Não havia contrato de CLI ou
serialização incompatível: este ADR define a representação que estava pendente
no ADR-006. Tudo usa biblioteca padrão e execução local.

### APIs e schema 1.0

`build_reports(IngestResult, ReplayResult, MetricsResult) -> dict[str, str]` é puro;
argumentos devem ser os resultados íntegros da mesma execução. Retorna exatamente
summary.json, report.md e errors.json, já renderizados em texto.
`write_reports(reports, output_dir, *, input_path)` publica esses três textos.

Raiz de **summary.json**:

| Campo | Tipo / significado |
|---|---|
| schema_version | string `1.0` |
| versions | objeto com versões reporting, replay e metrics |
| run_id | string SHA-256 determinística da projeção exportada, antes de adicionar run_id |
| scope | string do contrato de métricas (snapshot completo) |
| order_count | int: quantidade de projeções de pedidos; não substitui contagem elegível |
| orders | objeto indexado por order_id, contendo replay e indicators |
| aggregates | objeto indexado pelo nome do indicador agregado |
| operational_context | array de referências de eventos de restaurante, sem pedidos artificiais |
| excluded_histories | array de objetos order_id/reason; históricos não viram pedidos |
| diagnostic_order_ids | array de IDs sem histórico aceito, oriundo das métricas |

`orders[id].replay` preserva order_id, restaurant_id, status (string ou null),
resolution, evidence_quality, timeline, applied_event_ids, status_event_ids,
inconsistencies e ingestion_conflicts. Timeline contém metadados de eventos:
event_id, order_id, restaurant_id, type e occurred_at original. Mantém a ordem
UTC/event_id já definida pelo replay; aplicação é indicada por applied_event_ids.

`orders[id].indicators` preserva os campos de OrderMetrics: order_id, status,
resolution, evidence_quality, metrics e eligibility. Cada Metric tem name, value,
unit, reason, formula, sources, supporting_event_ids, evidence_quality,
order_resolution, order_evidence_quality, conflicts, issues e available.
Sources preservam event_id, event_type, field e timestamp. Eligibility preserva
eligible, reason e supporting_event_ids. Não são reinterpretados bloqueios locais
ou excluídas inconsistências para melhorar a qualidade de um agregado.

Cada AggregateMetric tem name, value, unit, reason, formula, criteria,
included_order_ids, excluded_orders (order_id/reason), supporting_events
(pares `[order_id,event_id]`), evidence_quality, numerator, denominator,
numerator_order_ids, denominator_order_ids e available. Campos não aplicáveis
continuam null, inclusive numerador/denominador de contagens.

**Valores:** Fraction vira objeto `{"numerator": int, "denominator": int}` reduzido,
com denominador positivo, inclusive inteiros racionais como 0/1. Contagens continuam
int; None vira null; bool continua bool. Não há conversão para float nem
arredondamento. A exibição humana usa n/d (ou n quando d=1), sem porcentagem
arredondada. Unidades e fórmulas são copiadas do motor de métricas.

Raiz de **errors.json**: schema_version, run_id (mesmo do summary), diagnostics
(array) e evidence_catalog (array). Cada diagnóstico tem stage (`ingest`/`replay`),
severity, classification e fatal=false. Ingestão ERROR é erro de registro,
nunca falha fatal do processo; duplicatas são INFO/duplicate; conflitos são
ERROR/conflict; demais rejeições são ERROR/invalid_event. Inconsistências são
WARNING/inconsistency; qualidade INCOMPLETE gera WARNING/incomplete_evidence.
Os campos code, message, event_id, affected_order_ids, affected_event_types e
origins vêm de Diagnostic. Questões de replay têm order_id, code, message e
evidence; avisos INCOMPLETE_EVIDENCE têm order_id e conflict_event_ids.
Campos inexistentes no objeto de origem não são preenchidos com dados inventados.

Origens contêm source, line e raw_text_sha256 (SHA-256 do texto decodificado
armazenado em Origin.raw, em UTF-8 com surrogatepass; não é hash da linha em bytes
quando houve erro de decodificação). Preserva todas as ocorrências, inclusive
variantes excluídas, mas não exporta linhas brutas ou payloads arbitrários.
Consultar a entrada preservada para examinar os conteúdos das variantes.
evidence_catalog lista metadados dos eventos aceitos e suas origens, por event_id.
Eventos de inconsistências também mantêm metadados e origens. A exportação é
uma projeção auditável, não um backup completo do log ou dos objetos Python.

**report.md** apresenta indicadores calculados, populações, motivos de exclusão,
fatos reconstruídos por pedido, fontes com campos e timestamps, marcos aplicados,
contexto e limitações. Cancelamento observado não implica causa verificada.
Texto recebido é escapado para Markdown/HTML e controles são representados
literalmente. Não atribuir responsabilidade automaticamente. Indicadores e causas
de indisponibilidade não são substituídos por hipóteses.

### Determinismo e idempotência

JSON usa ensure_ascii, sort_keys, indent=2 e newline final; todos os arquivos são
UTF-8 com LF, sem relógio ou UUID aleatório. Pedidos/métricas por chave; catálogo
por event_id; diagnósticos por JSON canônico; eventos nas ordens públicas anteriores.
run_id usa o SHA-256 do JSON canônico de summary sem run_id, incluindo as versões.
Identifica a projeção exportada, não os bytes originais nem uma tentativa única.
Não oferece assinatura, autenticação ou prova de completude.

Origens físicas ficam em errors.json, permitindo variar auditoria sem alterar
summary/report/run_id diante de duplicatas. Os relatórios de negócio mantêm
IDs, campos e timestamps necessários para cruzar com a auditoria. A mesma entrada
e configuração produz os três arquivos byte a byte idênticos. Embaralhar a entrada
pode mudar números de linha, origens e auditoria; preserva a projeção semântica.

### Caminhos, publicação e erros

Entrada deve existir e ser arquivo; saída deve ser diretório (criado se necessário).
Rejeitar destino que seja diretório, link simbólico ou coincida com a entrada,
inclusive alias resolvido/hardlink. Nomes dos três arquivos são fixos; não aceitar
nomes arbitrários no writer. Não modificar a entrada. As validações não são uma
proteção contra atacante trocando arquivos/links concorrentemente (TOCTOU).

Serializar tudo antes de publicar. Preparar temporários no diretório destino,
flush/fsync, preparar backups dos destinos existentes e usar os.replace por arquivo.
Em OSError comum, tentar restaurar destinos publicados e remover apenas os novos.
Se a restauração falhar, informar conjunto possivelmente misto e caminhos de backups
preservados. Temporários normais são limpos; diretório recém-criado pode ficar vazio.

Atomicidade é por arquivo, não transação de três arquivos. Queda, interrupção abrupta,
falha de recuperação ou execução concorrente pode deixar conjunto misto. Comparar
run_id entre os três relatórios antes de consumir um conjunto e executar novamente
após corrigir o problema. Não há lock, garantia de durabilidade do diretório ou
suporte a escritores concorrentes no MVP. Memória inclui textos e backups completos.

CLI: 0 para publicação bem-sucedida, mesmo com todos os registros inválidos;
1 para falha de I/O; 2 para argumentos/caminhos inválidos; ajuda retorna 0.
Saídas de terminal usam UTF-8, inclusive sob redirecionamento no Windows.
Falhas fatais não prometem gerar errors.json. Mensagens não incluem traceback
para falhas operacionais esperadas. Sempre consultar os diagnósticos: sem ID
identificável, registros rejeitados não permitem quantificar pedidos desconhecidos,
e COMPLETE continua limitado às evidências conhecidas conforme ADR-006.

### Correção da Code Review #004 — erros secundários e saída do terminal

`ReportWriteError` é uma subclasse de OSError: mantém a compatibilidade do writer
e da CLI, sem mudar o schema dos relatórios. Registra separadamente original_error,
rollback_errors (pares nome/erro), cleanup_errors (pares caminho/erro),
recovery_backups e publication_completed. A exceção primária é preservada como
causa explícita. A mensagem inclui o erro original, restauração incompleta quando
aplicável, backups protegidos e falhas secundárias de rollback/limpeza.

A limpeza tenta todos os temporários não protegidos e acumula OSError em vez de
substituir a exceção principal. A mesma proteção vale para falha de preparação de
um temporário antes de seu registro no writer. Backups necessários à recuperação
não são removidos. Falhas de limpeza podem deixar outros temporários, cujos caminhos
permanecem no erro. Falha apenas na limpeza após todas as substituições retorna
erro de I/O, informando publicação concluída, sem afirmar que os destinos antigos
foram preservados. publication_completed não promete transação ou concorrência.

A CLI trata escrita e flush dos streams, incluindo saída da ajuda/argparse.
Após falha de stdout, redireciona seu descritor para os.devnull para que o buffer
pendente não produza outra falha no encerramento do Python (código 120).
Streams fornecidos pelo chamador sem descritor utilizável são desativados em sys.
O diagnóstico é tentado em stderr; se este também falhar, seu flush é neutralizado.
Falhas do terminal retornam 1, inclusive quando os relatórios já foram publicados;
não revertem arquivos publicados nem apagam o erro original de publicação.
Mensagens de sucesso só são tentadas depois de o writer concluir sem erro.
Retornos normais 0 e 2, contratos de negócio e limites de atomicidade permanecem.
