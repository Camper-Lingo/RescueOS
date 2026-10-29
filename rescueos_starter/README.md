# RescueOS — Delivery Intelligence Control Tower

**Predict → Rescue → Explain.** Projeto educacional independente, com eventos totalmente simulados, para praticar AI Building, engenharia de workflows e avaliação de agentes.

## Visão

Um único produto com três módulos conectados por um log de eventos:

1. **SurgeShield** — detecta sobrecarga operacional e compara cenários simulados.
2. **RescueOps** — identifica pedidos em risco e propõe intervenções limitadas, aprovadas por humano.
3. **FairTrace** — reconstrói cronologias, distingue observações de hipóteses e gera dossiês verificáveis.

O painel central é a **Control Tower**, que mostra o que está acontecendo, por que uma intervenção é proposta e o que a simulação mostra como consequência.

## Primeira missão (MVP 0)

Criar um replay local de eventos que lê `fixtures/demo_events.jsonl`, valida os eventos, ignora duplicidades por `event_id`, ordena-os por tempo e exibe:

- status final de cada pedido;
- pedidos entregues após o prazo e minutos de atraso;
- pedidos cancelados;
- eventos que justificam o estado de cada pedido;
- avisos de dados insuficientes, sem inventar causas.

Não criar frontend, agentes, MCP, API ou n8n nesta primeira missão. Não usar serviços pagos. A implementação será delegada ao Codex e supervisionada por você.

## Documentos

- `docs/PRD.md` — produto e requisitos.
- `docs/ARCHITECTURE.md` — visão técnica, contrato dos eventos e limites.
- `docs/ROADMAP.md` — evolução por entregas e habilidades.
- `docs/DECISIONS.md` — decisões e justificativas.
- `docs/HANDOFF.md` — registro do estado do projeto.
- `FIRST_TASK_FOR_CODEX.md` — prompt para iniciar implementação.
- `AGENTS.md` — regras de trabalho do Codex neste repositório.

## Como começar no Windows

1. Extraia o pacote em uma pasta de projeto e abra essa pasta no VS Code.
2. Confira `docs/PRD.md`, `docs/ARCHITECTURE.md` e `fixtures/demo_checks.md`.
3. Abra o Codex e envie o conteúdo de `FIRST_TASK_FOR_CODEX.md`.
4. Leia o plano proposto pelo Codex **antes** de autorizar mudanças.
5. Depois da implementação, confira os valores de `fixtures/demo_checks.md` e execute os testes de verdade.

## Limites importantes

Projeto independente e não afiliado ao iFood. Não utiliza dados reais, credenciais, marcas em interfaces como se fosse oficial, nem APIs internas da empresa. Nenhuma estimativa de impacto é apresentada como resultado operacional real.
