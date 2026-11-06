import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { RoundedBox } from '@react-three/drei';
import { Group } from 'three';
import type { LiveOrder } from '../../simulation/live.ts';
import { LIVE_STATUS_LABELS } from '../../simulation/live.ts';
import { orderVisual } from '../../simulation/visualRoles.ts';
import type { Zone } from '../../simulation/replay.ts';
import type { ParcelPosition } from '../../simulation/parcelPlacement.ts';
import SceneLabel from '../SceneLabel.tsx';

export function liveZone(status: LiveOrder['status']): Zone {
  return status === 'QUEUED' ? 'entrance' : status === 'PREPARING' ? 'kitchen'
    : status === 'READY' ? 'pickup' : 'exit';
}

/** Comanda em pé: papel, prancheta e presilha; não parece uma caixa de delivery. */
function QueueTicket() {
  return <group name="modelo-comanda">
    <RoundedBox args={[.36, .41, .055]} position={[0, .015, 0]} radius={.025} castShadow>
      <meshStandardMaterial color="#426b75" roughness={.72}/>
    </RoundedBox>
    <mesh position={[0, .015, .033]}>
      <planeGeometry args={[.30, .35]}/><meshStandardMaterial color="#fff6db" side={2}/>
    </mesh>
    {[.19, .10, .01, -.08].map((y, i) => <mesh key={i} position={[-.025, .015 + y / 1.4, .039]}>
      <planeGeometry args={[i === 0 ? .19 : .23, .013]}/>
      <meshBasicMaterial color={i === 0 ? '#5a8790' : '#c2b39d'} side={2}/>
    </mesh>)}
    <RoundedBox args={[.105, .07, .078]} position={[0, .24, 0]} radius={.018}>
      <meshStandardMaterial color="#f2be69" metalness={.25}/>
    </RoundedBox>
  </group>;
}

/** Frigideira e alimento na chapa: silhueta baixa, com alça comprida. */
function CookingPan() {
  return <group name="modelo-panela">
    <mesh position={[0, -.07, 0]} castShadow>
      <cylinderGeometry args={[.22, .17, .12, 12]}/>
      <meshStandardMaterial color="#394a58" metalness={.35} roughness={.55}/>
    </mesh>
    <mesh position={[0, .004, 0]}>
      <cylinderGeometry args={[.17, .17, .015, 12]}/>
      <meshStandardMaterial color="#eab775" roughness={.9}/>
    </mesh>
    <mesh position={[.295, -.06, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
      <cylinderGeometry args={[.039, .039, .31, 8]}/>
      <meshStandardMaterial color="#634d44" roughness={.65}/>
    </mesh>
    <mesh position={[-.07, .043, .04]} scale={[.083, .048, .068]}>
      <sphereGeometry args={[1, 10, 6]}/><meshStandardMaterial color="#db7661"/>
    </mesh>
    <mesh position={[.07, .037, -.035]} scale={[.065, .045, .055]}>
      <sphereGeometry args={[1, 10, 6]}/><meshStandardMaterial color="#7eae6c"/>
    </mesh>
    <group name="vapor-do-preparo">
      {[0, 1].map(i => <mesh key={i} position={[-.08 + i * .15, .21 + i * .055, 0]} scale={[.035, .085, .035]}>
        <sphereGeometry args={[1, 6, 6]}/><meshStandardMaterial color="#e5efe5" transparent opacity={.75} depthWrite={false}/>
      </mesh>)}
    </group>
  </group>;
}

/** Sacola lacrada: volume vertical e alças. Para entregues, selo verde de conclusão. */
function ReadyBag({ delivered }: { delivered: boolean }) {
  return <group name={delivered ? 'modelo-entregue' : 'modelo-sacola-pronta'}>
    <RoundedBox args={[.33, .36, .27]} position={[0, .015, 0]} radius={.028} castShadow>
      <meshStandardMaterial color={delivered ? '#a9d7b5' : '#e6b96d'} roughness={.87}/>
    </RoundedBox>
    <mesh position={[0, .25, 0]}>
      <torusGeometry args={[.10, .021, 6, 12, Math.PI]}/>
      <meshStandardMaterial color="#7c6553" roughness={.8}/>
    </mesh>
    <RoundedBox args={[.19, .105, .012]} position={[0, .045, .141]} radius={.012}>
      <meshStandardMaterial color={delivered ? '#39866d' : '#fff5e2'} roughness={.8}/>
    </RoundedBox>
    <mesh position={[0, -.075, .147]}>
      <boxGeometry args={[.24, .025, .012]}/><meshStandardMaterial color="#9b755a"/>
    </mesh>
  </group>;
}

export default function LiveOrderParcel({ order, position, selected, reduced, onSelect }: {
  order: LiveOrder; position: ParcelPosition; selected: boolean; reduced: boolean; onSelect: (id: string) => void;
}) {
  const root = useRef<Group>(null);
  const scale = useRef(0);
  const previous = useRef(position.join(':'));
  useEffect(() => () => { document.body.style.cursor = ''; }, []);
  useFrame((_, delta) => {
    if (!root.current) return;
    const key = position.join(':');
    if (key !== previous.current) { previous.current = key; scale.current = .12; }
    root.current.position.set(...position);
    scale.current = reduced ? 1 : Math.min(1, scale.current + delta * 5);
    root.current.scale.setScalar(scale.current);
  });
  const visual = orderVisual(order.status);
  return <group ref={root} position={position} name={`live-order-${order.id}`}
    userData={{ orderId: order.id, visualStage: visual, status: order.status }}
    onClick={event => { event.stopPropagation(); onSelect(order.id); }}
    onPointerOver={() => { document.body.style.cursor = 'pointer'; }}
    onPointerOut={() => { document.body.style.cursor = ''; }}>
    {visual === 'ticket' && <QueueTicket/>}
    {visual === 'pan' && <CookingPan/>}
    {visual === 'bag' && <ReadyBag delivered={order.status === 'DELIVERED'}/>}
    {/* Área clicável unificada, inclusive na comanda fina. */}
    <mesh position={[0, .13, 0]}>
      <boxGeometry args={[.47, .62, .47]}/>
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
    {selected && <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -.13, 0]}>
      <ringGeometry args={[.31, .39, 32]}/><meshBasicMaterial color="#ffe59e" side={2}/>
    </mesh>}
    {selected && <group position={[0, .78, 0]}><SceneLabel title={order.id} selected subtitle={LIVE_STATUS_LABELS[order.status]} /></group>}
  </group>;
}
