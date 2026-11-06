export const MONSTERS = [
  { id: 'scout', name: 'SCOUT', color: '#72d7e3', role: 'Operações · procurar problemas', description: 'Eu ajudo a encontrar o que merece atenção. Abra meu painel para procurar ocorrências; a análise com IA só começa quando você solicitar.' },
  { id: 'fixer', name: 'FIXER', color: '#ef9874', role: 'Mitigação · futuro RescueOps', description: 'Mascote demonstrativo. Pode reagir a um atraso comprovado; não executa ações corretivas.' },
  { id: 'trace', name: 'TRACE', color: '#b5a2e7', role: 'Evidências · investigar pedidos', description: 'Eu reúno fatos e fontes para você entender um pedido. Não há investigação autônoma ou atribuição de culpa; você escolhe quando investigar.' },
  { id: 'runner', name: 'RUNNER', color: '#9cdcb4', role: 'Representação de retirada e entrega', description: 'Representação visual dos marcos aplicados do pedido selecionado. Não é um agente LLM.' },
  { id: 'coordinator', name: 'COORDINATOR', color: '#759bdb', role: 'Coordenação · aprovação humana futura', description: 'Mascote de supervisão. Esta demonstração não contém registros de aprovação humana.' },
] as const;
export type MonsterId = typeof MONSTERS[number]['id'];

