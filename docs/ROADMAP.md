# Roadmap de formação — RescueOS

Use gates de qualidade em vez de avançar por calendário fixo. O trabalho segue a lógica **aprender → construir → testar → explicar**.

| Fase | Entrega demonstrável | Competência AI Builder | Gate de avanço |
|---|---|---|---|
| 0 — Replay | JSONL → status, atrasos e relatório | Prompt/Context Engineering, Codex, Git, Python/JSON e testes | 8 critérios do PRD e testes repetíveis |
| 1 — Torre | API local + dashboard com timeline | Vibe coding, APIs, contratos, UI, debug | Alguém usa sem alterar código; dados conferem |
| 2 — SurgeShield | Simulador de pico, filas e risco por regras | Análise de dados, modelagem e avaliação | Mesmo seed/inputs reproduzem resultados; não inventar causalidade |
| 3 — RescueOps | Propostas, aprovação humana e n8n | Webhooks, integrações, idempotência, automação | Repetição não duplica efeito; erro deixa rastro |
| 4 — FairTrace | Dossiê de evidências e lacunas | RAG/contexto, tool calling, MCP, agente e revisor | Respostas citam eventos corretos e admitem desconhecido |
| 5 — Experimentos | Comparador baseline/intervenção e evals | Orquestração multiagente, observabilidade, custos | Métricas com denominador, holdout e limitações claras |
| 6 — Portfólio | Demo segura, documentação, vídeo curto | Engenharia de produto e comunicação | Reproduzível, acessível e tecnicamente defensável |

## Treinos para entrevistas por fase

- **0:** Como tratar evento duplicado e evento que chega fora de ordem? O que é idempotência?
- **1:** O que faz uma API REST? Quando retorna 400, 401, 403, 404 ou 429?
- **2:** Por que uma regra de negócio é melhor que LLM para calcular atrasos? O que é um falso positivo?
- **3:** O que acontece se um webhook for entregue duas vezes? Como garantir aprovação verdadeira?
- **4:** Qual a diferença entre ferramenta, MCP, skill, agente e workflow? O que fazer sem evidência?
- **5:** Como comparar duas estratégias sem atribuir ganho real a uma simulação? Que métricas indicam valor?
- **6:** Quais são os riscos de usar IA aqui? Como operar, monitorar e desfazer ações?

## Diferenciais para o portfólio

- Um produto único com *predict, rescue, explain*, e não três chatbots desconectados.
- Incidente reproduzível em replay e dossiê com evidências auditáveis.
- Simulações comparáveis usando mesmas premissas e a mesma semente aleatória.
- Consentimento/aprovação em ações simuladas e registro das decisões.
- Falhas e abstenção visíveis, sem demonstração baseada em números inventados.
