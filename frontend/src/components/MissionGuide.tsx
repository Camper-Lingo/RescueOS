import { useEffect, useRef } from 'react';

export type MissionStep = 'welcome' | 'free' | 'scout' | 'alert' | 'arrival' | 'pickup' | 'trace' | 'done';
export type MissionAction = 'start' | 'free' | 'scout' | 'order' | 'arrival' | 'pickup' | 'trace' | 'done' | 'overview';
export interface MissionDemo { orderId: string; wait: string; delay: string; arrival: string; pickup: string }

export default function MissionGuide({ step, demo, frame, total, reduced, onAction }: {
  step: MissionStep; demo: MissionDemo | null; frame: number; total: number; reduced: boolean;
  onAction: (action: MissionAction) => void;
}) {
  const guide = useRef<HTMLElement>(null);
  useEffect(() => {
    if (step !== 'welcome' && step !== 'free') {
      guide.current?.focus({ preventScroll: true });
      guide.current?.scrollIntoView({ block: 'nearest', behavior: reduced ? 'instant' : 'smooth' });
    }
  }, [step, reduced]);
  if (step === 'free') return <div className="learning-bar">
    <span>Exploração livre · escolha um personagem ou pedido.</span>
    <button onClick={() => onAction('start')} disabled={!demo}>Reiniciar primeira missão</button>
  </div>;
  if (step === 'welcome') return <section className="welcome-card" aria-label="Boas-vindas ao RescueOS">
    <div><span className="eyebrow">Aprenda explorando</span><h2>Bem-vindo ao RescueOS!</h2>
      <p>Explore um restaurante, investigue atrasos e descubra como nossos agentes de IA ajudam a entender os problemas.</p>
      <p className="micro muted">A primeira missão é uma demonstração guiada dos eventos. Não executa IA.</p></div>
    <div className="learning-actions"><button className="primary" disabled={!demo} onClick={() => onAction('start')}>Começar primeira missão</button>
      <button onClick={() => onAction('free')}>Explorar livremente</button></div>
    {!demo && <p>A missão do pedido ord-1002 não está disponível neste cenário. Você pode explorar os dados livremente.</p>}
  </section>;
  if (!demo) return <section className="mission-guide"><p>Os dados desta missão não estão disponíveis.</p>
    <button onClick={() => onAction('free')}>Explorar livremente</button></section>;
  const steps = ['scout', 'alert', 'arrival', 'pickup', 'trace', 'done'];
  const copy = {
    scout: ['Conheça Scout', 'Scout ajuda a encontrar o que merece atenção. Selecione o monstrinho azul ou use o botão abaixo.', 'Selecionar Scout', 'scout'],
    alert: ['Uma espera para explorar', `O histórico de ${demo.orderId} comprova ${demo.wait} min de espera e ${demo.delay} min de atraso na entrega. Vamos encontrar esse pedido?`, 'Ver pedido ' + demo.orderId, 'order'],
    arrival: ['Volte ao início da espera', 'O pedido está destacado. Agora volte ao momento em que o entregador chegou à retirada.', 'Voltar à chegada', 'arrival'],
    pickup: ['Acompanhe até a coleta', `O entregador chegou às ${demo.arrival}. Neste ponto, a espera final ainda não está disponível. Avance até a coleta.`, 'Avançar até a coleta', 'pickup'],
    trace: ['Conheça Trace', `Coleta às ${demo.pickup}: a espera observada foi de ${demo.wait} min. Trace reúne fatos e fontes de um pedido; não determina culpa.`, 'Abrir investigação no Trace', 'trace'],
    done: ['Missão concluída!', `Você encontrou ${demo.orderId}, explorou a espera de ${demo.wait} min entre chegada e coleta e conheceu Trace. Esses registros não demonstram causa ou responsabilidade.`, 'Explorar livremente', 'free'],
  }[step];
  return <section id="mission-guide" ref={guide} tabIndex={-1} className="mission-guide" aria-label="Primeira missão">
    <div className="mission-heading"><span className="eyebrow">O mistério do pedido atrasado</span>
      <button aria-label="Sair da missão" onClick={() => onAction('free')}>×</button></div>
    <span className="mission-progress">Passo {steps.indexOf(step) + 1} de {steps.length} · Demonstração sem IA</span>
    <h2>{copy[0]}</h2><p>{copy[1]}</p>
    <div className="learning-actions"><button className="primary" onClick={() => onAction(copy[3] as MissionAction)}>{copy[2]}</button>
      {step === 'trace' && <button onClick={() => onAction('done')}>Concluir missão sem IA</button>}
      <button onClick={() => onAction('overview')}>Voltar à visão geral</button>
      {step !== 'done' && <button onClick={() => onAction('start')}>Reiniciar missão</button>}</div>
    <p className="micro muted">Demonstração baseada no histórico completo ({total} eventos). Replay atual: {frame}/{total}.
      {step === 'trace' && ' Abrir Trace não executa a investigação. O botão “Investigar com Trace” solicita IA local e é opcional.'}</p>
  </section>;
}
