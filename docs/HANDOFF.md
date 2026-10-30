# Handoff / estado do projeto

**Estado atual:** Fase 0, etapa 1 implementada em 2026-10-29; aguardando revisão do usuário.

**Próxima tarefa:** revisar ingestão e políticas do ADR-004. Aguardar aprovação explícita antes de avançar para replay.

**Evidências disponíveis:** PRD, arquitetura, gabarito das fixtures e decisões.

**Não concluído:** replay, estados, métricas, exportadores finais, dashboard, n8n, agente, MCP, deploy e medições reais.

**Arquivos criados:** `rescueos/__init__.py`, `rescueos/contracts.py`,
`rescueos/ingest.py`, `tests/__init__.py`, `tests/test_ingest.py`.
**Documentos atualizados:** `README.md`, `docs/DECISIONS.md`, `docs/HANDOFF.md`.

**Ambiente conferido antes das mudanças:** diretório atual e raiz Git
`D:\rescueos_starter`; `git status --short` vazio. Nenhuma subpasta de projeto criada.

**Verificação executada:** `python -m unittest discover -s tests -v` — 23 testes,
todos aprovados, Python 3.14.4. Inclui ingestão dos 20 eventos originais e conferência
de bytes da fixture, duplicatas, conflitos com origens, dados/timestamps inválidos,
UTF-8 inválido, continuidade após erro e texto tratado somente como dado.
Não foram executados testes de replay ou métricas, pois não foram implementados.

**Limitações:** entrada completa agrupada em memória; identidade não persistida
entre chamadas; erros de arquivo propagam `OSError`. Consequências de conflitos
são sinalizadas por pedidos/tipos, sem calcular métricas. Confirmar contrato de
`data` e perfil de timestamp detalhados no ADR-004. Sem dependências instaladas,
fixtures alteradas, commit ou push.

**Ao encerrar cada sessão:** registrar arquivos alterados, comandos e resultados executados, decisões, pendências e próximo passo. Não declarar testes como aprovados sem executá-los.

## Correção da Code Review #001 — 2026-10-29

Estado: dois bugs numéricos corrigidos; aguardando revisão. Não avançar para replay.
O estado Git inicial desta correção já continha README/DECISIONS/HANDOFF modificados
e `rescueos/` e `tests/` não rastreados; esse trabalho foi preservado.

Arquivos desta correção: `rescueos/ingest.py`, novo `tests/test_numeric_ingest.py`,
`README.md`, `docs/DECISIONS.md` e este handoff. `contracts.py` e os 23 testes
anteriores em `tests/test_ingest.py` não foram alterados.

Testes escritos e executados antes da correção:
`python -B -m unittest tests.test_numeric_ingest -v` — 4 testes;
2 erros `decimal.InvalidOperation` e 3 falhas de asserção (incluindo dois subtestes
de ordem das variantes). Depois da correção, os mesmos 4 testes passaram.

Uma execução intermediária da suíte de 27 testes encontrou 1 falha por diagnósticos
de contrato em cascata após erro numérico. A correção priorizou os diagnósticos
numéricos nessa linha, preservando os testes antigos sem alteração.

Verificação final: `python -B -m unittest discover -s tests -v` — 39 testes,
todos aprovados em Python 3.14.4 (23 anteriores + 16 novos). Inclui limites,
continuidade, conflitos em ambas as ordens, origens completas, JSON malformado,
arrays e independência do contexto Decimal. Políticas e riscos residuais no ADR-004.

Sem instalação de dependências, commit, push, replay, métricas ou exportadores.
