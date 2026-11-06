# Stage 8B — Benchmark offline de confiabilidade dos agentes

Esta etapa **não treina outro modelo e não chama Ollama**. Exercita os agentes reais `ScoutAgent` e `TraceAgent` com um **provedor stub controlado**, usando a fixture sintética histórica. Serve para validar a proteção de referências, ferramentas e evidências, e estabelecer uma baseline de segurança antes de testar o Qwen real.

## Executar (PowerShell, raiz do projeto)

Use a `.venv` do projeto, na qual `pydantic`, `fastapi` e `httpx` já são usados pelo backend:

```powershell
cd D:\rescueos_starter
.\.venv\Scripts\python.exe -B ai_lab\reliability.py
.\.venv\Scripts\python.exe -B -m unittest discover -s ai_lab -p test_reliability.py -v
```

Outputs em `ai_lab/out/reliability-report.md` e `ai_lab/out/reliability-results.json`. Os artefatos da Stage 8A permanecem intactos.

## Avaliação

- Casos limpos: operações conhecidas nos quadros 0, 18 e 20; Trace nos pedidos entregues no prazo e atrasado.
- Casos adversariais: métrica `999`, origem trocada, status falso, explicação não canônica, campo extra, ID inventado/duplicado, JSON inválido, ferramentas não autorizadas e ausência de evidência.
- Cada caso define antecipadamente o resultado esperado: aprovação ou rejeição com código específico.
- O programa sai com código de erro se algum caso falhar.

**Limitações:** esta rodada não mede taxa de acerto, F1, alucinações ou latência de um LLM real, nem representa pedidos reais do iFood. Para isso, a próxima etapa precisará testar uma amostra com modelo instalado, com autorização manual e temperatura monitorada. Os casos aqui se apoiam na fixture histórica, **não** no ambiente simulado de noites aleatórias do frontend; essa integração é uma evolução separada.
