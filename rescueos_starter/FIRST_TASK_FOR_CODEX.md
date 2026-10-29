# PRIMEIRA TAREFA PARA O CODEX — FASE 0

Você será o engenheiro executor de um projeto educacional chamado RescueOS; eu atuarei como gestor e revisor. Antes de qualquer implementação:

1. Leia README.md, docs/PRD.md, docs/ARCHITECTURE.md, docs/DECISIONS.md, AGENTS.md e fixtures/demo_checks.md.
2. Inspecione o ambiente sem alterar arquivos. Resuma o problema, os contratos, os riscos e apresente plano de até seis passos.
3. Aguarde minha aprovação do plano antes de modificar arquivos.

**Depois da aprovação**, implemente apenas o MVP 0:

- Leitor local para fixtures/demo_events.jsonl, sem bibliotecas externas.
- Validação de estrutura, tipo e timestamps ISO 8601 com offset.
- Deduplicação de event_id; detectar conflito de mesmo ID com conteúdo divergente.
- Ordenação determinística e reconstrução de timeline/status por pedido.
- Cálculo de atraso de entrega, atraso na finalização da cozinha e espera do entregador, com resultados em minutos e origem identificável.
- Exportação de `out/summary.json`, `out/report.md` e `out/errors.json` sem alterar fixtures.
- Testes unittest com gabarito de fixtures/demo_checks.md, duplicatas, fora de ordem e entradas inválidas.
- README com comandos reais do PowerShell para executar e testar.

**Não fazer agora:** frontend, APIs HTTP, n8n, agentes, MCP, modelo pago, Docker, deploy nem integração com iFood.

**Ao concluir:** informe arquivos criados, resumo das decisões, diff relevante, comandos realmente executados, resultado dos testes, limitações e como conferir manualmente o pedido ord-1002. Nunca apresente teste não executado como aprovado.
