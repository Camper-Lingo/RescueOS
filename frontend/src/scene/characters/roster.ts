export const MONSTERS = [
  { id: 'scout', name: 'SCOUT', color: '#72d7e3', role: 'Monitoramento · futuro SurgeShield', description: 'Patrulha decorativa. Sinais exibidos vêm dos dados; nenhuma previsão de IA está em execução.' },
  { id: 'fixer', name: 'FIXER', color: '#ef9874', role: 'Mitigação · futuro RescueOps', description: 'Mascote demonstrativo. Pode reagir a um atraso comprovado; não executa ações corretivas.' },
  { id: 'trace', name: 'TRACE', color: '#b5a2e7', role: 'Evidências · FairTrace', description: 'Não há investigação autônoma ou atribuição de culpa. Abra o painel Trace no pedido para solicitar uma investigação com LLM local e ferramentas de leitura.' },
  { id: 'runner', name: 'RUNNER', color: '#9cdcb4', role: 'Representação de retirada e entrega', description: 'Representação visual dos marcos aplicados do pedido selecionado. Não é um agente LLM.' },
  { id: 'coordinator', name: 'COORDINATOR', color: '#759bdb', role: 'Coordenação · aprovação humana futura', description: 'Mascote de supervisão. Esta demonstração não contém registros de aprovação humana.' },
] as const;
export type MonsterId = typeof MONSTERS[number]['id'];

