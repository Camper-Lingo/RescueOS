# RescueOS AI Lab — Stage 8B (offline)

> **Benchmark de validação do fluxo dos agentes com respostas simuladas. Não mede a acurácia de um LLM real.**

- Casos aprovados: **20/20**
- Adulterações/respostas adversariais rejeitadas corretamente: **15/15**

| Caso | Agente | Resultado esperado | Observado | Passou |
|---|---|---|---|---|
| `scout_final_clean` | scout | `completed` | `completed` | sim |
| `scout_empty_frame` | scout | `completed` | `completed` | sim |
| `scout_partial_frame` | scout | `completed` | `completed` | sim |
| `trace_delayed_order` | trace | `completed` | `completed` | sim |
| `trace_on_time_order` | trace | `completed` | `completed` | sim |
| `scout_forged_999` | scout | `TOOL_RESULT_MISMATCH` | `TOOL_RESULT_MISMATCH` | sim |
| `scout_forged_source` | scout | `TOOL_RESULT_MISMATCH` | `TOOL_RESULT_MISMATCH` | sim |
| `scout_forged_status` | scout | `TOOL_RESULT_MISMATCH` | `TOOL_RESULT_MISMATCH` | sim |
| `scout_false_explanation` | scout | `TOOL_RESULT_MISMATCH` | `TOOL_RESULT_MISMATCH` | sim |
| `scout_unexpected_field` | scout | `TOOL_RESULT_MISMATCH` | `TOOL_RESULT_MISMATCH` | sim |
| `scout_invented_alert` | scout | `UNSUPPORTED_REFERENCE` | `UNSUPPORTED_REFERENCE` | sim |
| `scout_duplicate_alert` | scout | `UNSUPPORTED_REFERENCE` | `UNSUPPORTED_REFERENCE` | sim |
| `scout_missing_metric_focus` | scout | `UNSUPPORTED_EXPLANATION` | `UNSUPPORTED_EXPLANATION` | sim |
| `scout_invalid_json` | scout | `INVALID_MODEL_RESPONSE` | `INVALID_MODEL_RESPONSE` | sim |
| `scout_forbidden_tool` | scout | `INVALID_MODEL_RESPONSE` | `INVALID_MODEL_RESPONSE` | sim |
| `trace_forged_999` | trace | `TOOL_RESULT_MISMATCH` | `TOOL_RESULT_MISMATCH` | sim |
| `trace_forged_source` | trace | `TOOL_RESULT_MISMATCH` | `TOOL_RESULT_MISMATCH` | sim |
| `trace_invented_fact` | trace | `UNSUPPORTED_REFERENCE` | `UNSUPPORTED_REFERENCE` | sim |
| `trace_duplicate_fact` | trace | `UNSUPPORTED_REFERENCE` | `UNSUPPORTED_REFERENCE` | sim |
| `trace_without_state` | trace | `MISSING_EVIDENCE` | `MISSING_EVIDENCE` | sim |

## Limites do experimento

- Avalia o contrato das ferramentas, comparação com respostas canônicas e validação de referências usando a fixture histórica aprovada.
- As respostas do provedor são geradas por stub controlado: não há Ollama, inferência nem comparação de qualidade de raciocínio.
- O catálogo serve como oráculo parcial de quatro alertas do quadro 20. Não testa cobertura em produção ou no conjunto das noites vivas.
- Os tempos medidos são de stubs e **não são latência real de LLM**.
- Próximo passo: avaliar uma pequena amostra com Qwen3:4b real, com execução manual autorizada e monitoramento térmico.
