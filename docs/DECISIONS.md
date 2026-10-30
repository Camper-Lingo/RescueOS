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
