# RescueOS AI Lab — primeiro benchmark

**Pergunta:** ao receber o pedido, conseguimos prever se ele vai atrasar?

**Dataset:** 6270 pedidos sintéticos; 3942 treino e 991 teste com entrega concluída.
**Pendentes excluídos:** 1083 no treino, 254 no teste.
**Split:** por semente, nunca por linhas aleatórias.

| Método | Precision (atraso) | Recall (atraso) | F1 (atraso) | Balanceada |
| --- | ---: | ---: | ---: | ---: |
| always_majority | 0.000 | 0.000 | 0.000 | 0.500 |
| fixed_rule | 0.735 | 0.665 | 0.698 | 0.791 |
| logistic_regression | 0.721 | 0.925 | 0.810 | 0.901 |

## Performance por cenário (teste)

| Cenário | Pedidos | % atrasos | F1 do ML |
|---|---:|---:|---:|
| quiet | 233 | 2.6% | 0.545 |
| medium | 358 | 4.8% | 0.304 |
| busy | 400 | 57.8% | 0.860 |

## Interpretação

Não concluir que o modelo é melhor que a regra sem consultar os números, erros e distribuição por cenário.
A comparação é **somente dentro de dados sintéticos gerados pelo mesmo simulador**.
Há viés de sobrevivência: pedidos pendentes não têm rótulo de entrega no prazo/atrasada.

## Próximos experimentos

1. Adicionar casos de incidentes por tipo e validação de segurança do Scout.
2. Medir repetibilidade em mais sementes e construir validação fora da distribuição.
3. Testar o Qwen3:4b em amostra pequena com a mesma tarefa e gabarito, com monitoramento térmico.
