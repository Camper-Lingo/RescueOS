import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { RoundedBox } from '@react-three/drei';
import { Group, Vector3 } from 'three';
import type { Order } from '../../types/api.ts';
import { STATUS_LABELS, visualOrder, ZONE_POSITIONS } from '../../simulation/replay.ts';
import SceneLabel from '../SceneLabel.tsx';

export default function OrderParcel({ order, offset, selected, reduced, onSelect, alerted }: {
  order: Order; offset: number; selected: boolean; reduced: boolean; onSelect: (id: string) => void; alerted: boolean;
}) {
  const visual = visualOrder(order);
  const zone = ZONE_POSITIONS[visual.zone];
  const x = zone[0] + (visual.zone === 'exit' ? 0 : (offset % 2) * .7) - .25;
  const z = zone[2] + (visual.zone === 'exit' ? offset * 1.05 - .7 : Math.floor(offset / 2) * .65);
  const target = useMemo(() => new Vector3(x, visual.zone === 'pickup' ? 1.25 : .27, z), [x, z, visual.zone]);
  const root = useRef<Group>(null);
  useEffect(() => () => { document.body.style.cursor = ''; }, []);
  const initial = useRef<[number, number, number]>([target.x, target.y, target.z]);
  useFrame((_, delta) => {
    if (root.current) { if (reduced) root.current.position.copy(target); else root.current.position.lerp(target, 1 - Math.exp(-delta * 8)); }
  });
  return <group ref={root} position={initial.current} onClick={event => { event.stopPropagation(); onSelect(order.order_id); }}
    onPointerOver={() => { document.body.style.cursor = 'pointer'; }} onPointerOut={() => { document.body.style.cursor = ''; }}>
    <RoundedBox args={[.5, .37, .42]} radius={.045} smoothness={2} castShadow>
      <meshStandardMaterial color={selected ? '#f5d39a' : '#d9ba8d'} roughness={.82} transparent opacity={visual.uncertain ? .7 : 1} />
    </RoundedBox>
    <mesh position={[0, .19, 0]}><boxGeometry args={[.085, .009, .43]} /><meshStandardMaterial color={visual.color} /></mesh>
    <mesh position={[0, .025, .216]}><planeGeometry args={[.2, .12]} /><meshStandardMaterial color="#faf0da" /></mesh>
    {/* Contorna a face superior do pacote; o piso e os balcões ocultavam o anel inferior. */}
    {(selected || alerted) && <mesh name={`${alerted ? 'scout-alert' : 'order-selection'}-${order.order_id}`}
      rotation={[-Math.PI / 2, 0, 0]} position={[0, .2, 0]}>
      <ringGeometry args={[alerted ? .62 : .53, alerted ? .68 : .59, 32]} /><meshBasicMaterial color={alerted ? '#efbd68' : visual.color} /></mesh>}
    <mesh position={[0, .38, 0]}><cylinderGeometry args={[.008, .008, .4, 4]} /><meshBasicMaterial color="#779b90" /></mesh>
    <group position={[0, selected ? .85 : .6, 0]}><SceneLabel title={order.order_id} selected={selected}
      subtitle={visual.uncertain ? 'Conclusão limitada' : STATUS_LABELS[order.status ?? ''] ?? 'Sem projeção'} /></group>
  </group>;
}
