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
