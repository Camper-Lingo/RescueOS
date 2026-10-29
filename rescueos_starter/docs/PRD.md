# PRD v0.1 — RescueOS: Delivery Intelligence Control Tower

**Data:** 2026-10-29  
**Status:** primeira especificação para aprendizado; sujeita a revisão baseada em testes  
**Categoria:** projeto educacional independente, com dados sintéticos

## 1. Problema

Uma operação de delivery produz uma sequência de eventos: pedidos criados, preparo iniciado, comida pronta, entregador chegando, coleta, entrega, cancelamento e alterações de capacidade. Quando a operação sobrecarrega, decisões mal informadas podem aumentar atrasos e gerar disputas. A pessoa responsável precisa enxergar sinais de risco, decidir o que pode fazer e reconstruir o que ocorreu com evidências, sem culpar alguém automaticamente.

## 2. Usuários

- **Operador de restaurantes:** identifica gargalos e aprova ações locais simuladas.
- **Analista de operações:** compara cenários e avalia gargalos.
- **Analista de ocorrências:** investiga atrasos e pedidos cancelados com cronologia verificável.

## 3. Proposta de valor

Um sistema unificado que **prevê riscos (SurgeShield)**, **auxilia na resposta (RescueOps)** e **explica ocorrências (FairTrace)**, usando o mesmo histórico de eventos e decisões rastreáveis.

## 4. Fluxo principal do produto

1. O simulador gera eventos sintéticos com IDs, tempo e origem.
2. O sistema valida e registra eventos; rejeita registros inválidos e ignora reenvios por ID.
3. O estado dos pedidos é reconstruído. Uma camada determinística detecta riscos e atrasos.
4. SurgeShield resume condições de capacidade e propõe cenários para simulação.
5. RescueOps sugere intervenções *reversíveis no ambiente simulado*.
6. Um humano aprova, rejeita ou pede esclarecimentos antes da execução da intervenção.
7. FairTrace monta um dossiê com linha do tempo, fatos conhecidos, lacunas e hipóteses explicitamente marcadas.
8. O operador compara o cenário base com o cenário de intervenção sob as mesmas premissas e semente de simulação.

## 5. Módulos do produto

### SurgeShield — Prever

**Entrada:** contagem de pedidos por janela, capacidade declarada, tempos observados, fila de preparo.  
**Saída:** indicadores de sobrecarga, alerta justificado e simulador de cenários.  
**Limite:** no começo são regras de negócio, não previsão estatística treinada. Comparações simuladas não demonstram ganho real.

### RescueOps — Intervir

**Entrada:** pedidos em risco, políticas de ações permitidas e limites.  
**Saída:** opção de ação, justificativa, custo/impacto hipotético e pedido de aprovação.  
**Exemplos simulados:** priorizar um preparo, enviar aviso rascunhado a operador, suspender promoção *no simulador*.  
**Limite:** não enviar mensagens reais, nem alterar pedidos ou contas externos.

### FairTrace — Explicar

**Entrada:** eventos de pedido, logs de alterações e decisões.  
**Saída:** cronologia com IDs de evidência, diferenças entre previsto e observado, lacunas e hipóteses para revisão.  
**Limite:** não determinar culpa, fraude ou penalidade com base apenas em correlação ou dados incompletos.

### Control Tower — Interface

Mostra painel de filas, mapa lógico de estados (não mapa geográfico real), alertas, aprovações, replay por pedido e scorecard de avaliações. Quando uma informação está ausente, exibe “indisponível”.

## 6. Primeira entrega obrigatória: MVP 0 (replay confiável)

**IN:** JSON Lines local em `fixtures/demo_events.jsonl`.  
**OUT:** JSON com estado dos pedidos e resumo, relatório Markdown, lista de erros.  
**Regras:** eventos identificados por `event_id`; sem duplicar processamento; preservar fonte; rejeitar tipo inválido e campos faltantes; ordenar por `occurred_at` com desempate determinístico; reconstruir cronologia por `order_id`; não inventar motivo de atraso ou cancelamento; usar horário ISO 8601 com offset.  
**Escopo:** somente execução local. Sem IA em runtime, n8n, serviços pagos, frontend ou deploy.

## 7. Requisitos de qualidade

- Rastreabilidade: cada número do relatório deve ser reproduzível a partir de eventos de origem.
- Determinismo: mesma entrada e mesma versão retornam os mesmos resultados.
- Correção: atrasos em minutos calculados sobre timestamps com offset.
- Tratamento explícito de erros: nenhuma linha inválida entra silenciosamente nos totais.
- Segurança: dados textuais em eventos nunca são executados como comandos ou instruções.
- Observabilidade: IDs de execução, eventos rejeitados e erros identificáveis.
- Privacidade: somente dados fictícios no repositório público.

## 8. Critérios de aceitação do MVP 0

1. O exemplo contém três pedidos: um entregue no prazo, um entregue com atraso e um cancelado.
2. O pedido `ord-1001` foi entregue às 18:43, cinco minutos antes do prazo de 18:48.
3. O pedido `ord-1002` foi entregue às 19:05, treze minutos depois do prazo de 18:52; o preparo ficou pronto onze minutos depois do prometido; o entregador esperou treze minutos entre chegada e coleta.
4. O pedido `ord-1003` foi cancelado; o sistema não infere responsável ou causa a partir apenas desse fato.
5. Repetir o mesmo evento com o mesmo `event_id` não altera resultados.
6. Um evento desconhecido ou sem timestamp válido gera erro claro, sem quebrar toda a execução.
7. Um pedido sem dados suficientes é marcado “dados insuficientes” em vez de receber tempo inventado.
8. Todos os testes automatizados passam e o README informa como reproduzir a execução no Windows.

## 9. Métricas para fases futuras

Taxa de pedidos atrasados, minutos de atraso, tempo de espera de entregador, pedidos cancelados, tempo até alerta, tempo até decisão humana, tempo de resposta da automação, custo por execução, precisão de detecção, falso positivo e número de recomendações aprovadas/rejeitadas. Denominadores e períodos devem ser explícitos.

## 10. Fora de escopo no início

Acesso a bases ou APIs privadas do iFood, roteamento logístico real, localização de pessoas, descontos reais, punição automática, detecção de fraude sobre indivíduos, previsão “garantida”, pagamentos e publicação sem revisão humana.

## 11. Demonstração final desejada

Um operador abre a Control Tower, dispara uma simulação de pico de demanda, vê pedidos em risco, investiga um pedido, aprova uma intervenção simulada, compara cenários equivalentes e baixa um dossiê de evidências. O sistema mostra também incertezas, eventos faltantes e custo de execução.
