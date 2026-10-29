# Gabarito manual — demo_events.jsonl

**Tudo abaixo é fictício.** Os eventos descrevem um cenário de teste, não a operação do iFood.

- Quantidade de pedidos distintos criados: **3**.
- `ord-1001`: status **DELIVERED**; entrega **18:43**, prazo **18:48**; antecedência **5 minutos**.
- `ord-1002`: status **DELIVERED**; entrega **19:05**, prazo **18:52**; atraso de entrega **13 minutos**.
- `ord-1002`: cozinha pronta às **18:34**, prometida para **18:23**; atraso de preparo **11 minutos**.
- `ord-1002`: entregador chegou às **18:22** e coletou às **18:35**; espera **13 minutos**.
- `ord-1003`: status **CANCELLED**; não atribuir automaticamente culpa, mesmo havendo dados de fila e promoção.
- Total de pedidos entregues atrasados: **1**.
- Total de pedidos cancelados: **1**.
- Total de pedidos entregues no prazo: **1**.

## Testes adicionais que o Codex deve criar

1. Inserir novamente um evento com mesmo ID/conteúdo: saída idêntica.
2. Reordenar as linhas: saída de métricas e status idêntica.
3. Mesmo ID com payload diferente: indicar conflito e política de tratamento explícita.
4. Timestamp sem offset: erro explicativo.
5. Tipo desconhecido: erro explicativo.
6. Evento de entrega sem pedido previamente criado: inconsistência registrada.
7. Evento sem campo obrigatório: rejeição da linha e identificação do motivo.
8. Texto de evento que tenta dar instruções: processar apenas como dado, nunca executar.
