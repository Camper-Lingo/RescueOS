import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { RoundedBox } from '@react-three/drei';
import { Group, MathUtils } from 'three';
import type { LiveOrder } from '../../simulation/live.ts';
import SceneLabel from '../SceneLabel.tsx';

/** Motoboy puramente visual: existência e coleta dependem dos eventos do pedido. */
export default function LiveCourier({ order, index, minute, selected, reduced, running, onSelect }: {
  order: LiveOrder; index: number; minute: number; selected: boolean; reduced: boolean; running: boolean;
  onSelect: (id: string) => void;
}) {
  const root = useRef<Group>(null);
  const origin = [4.18, .14, 1 + index * .36] as const;
  const station = [[3.55, .14, .06], [4, .14, .63], [3.6, .14, 1.34]][index] as number[];
  const leaving = order.pickedUpAt !== null;
  const target = leaving ? origin : station;
  useEffect(() => () => { document.body.style.cursor = ''; }, []);
  useFrame(({ clock }, delta) => {
    if (!root.current || !running) return;
    const position = root.current.position;
    const amount = reduced ? 1 : 1 - Math.exp(-delta * 2.8);
    position.x = MathUtils.lerp(position.x, target[0], amount);
    position.z = MathUtils.lerp(position.z, target[2], amount);
    const walking = Math.hypot(target[0] - position.x, target[2] - position.z) > .09;
    const step = reduced ? 0 : walking ? Math.abs(Math.sin(clock.elapsedTime * 10 + index)) * .055 : 0;
    const body = root.current.getObjectByName('rider-body');
    if (body) body.position.y = step;
    root.current.rotation.y = reduced ? 0 : MathUtils.damp(root.current.rotation.y, leaving ? 1.3 : -1.4, 4, delta);
  });
  return <group ref={root} name={`courier-${order.id}`} position={origin}
    onClick={e => { e.stopPropagation(); onSelect(order.id); }}
    onPointerOver={() => { document.body.style.cursor = 'pointer'; }}
    onPointerOut={() => { document.body.style.cursor = ''; }}>
    {selected && <group position={[0, 1.75, 0]}><SceneLabel title={`Motoboy · ${order.id}`} selected
      subtitle={leaving ? 'Levando o pedido' : order.status === 'READY' ? 'Buscando pedido pronto' : 'Esperando na retirada'}/></group>}
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, .03, 0]}><circleGeometry args={[.31, 20]}/>
      <meshBasicMaterial color={selected ? '#ffdc9c' : '#456d6f'} transparent opacity={.55}/></mesh>
    <group name="rider-body">
      <mesh position={[-.13, .16, 0]}><capsuleGeometry args={[.105, .23, 4, 8]}/><meshStandardMaterial color="#213e52"/></mesh>
      <mesh position={[.13, .16, 0]}><capsuleGeometry args={[.105, .23, 4, 8]}/><meshStandardMaterial color="#213e52"/></mesh>
      <RoundedBox position={[0, .67, 0]} args={[.48, .55, .36]} radius={.14} castShadow>
        <meshStandardMaterial color={index % 2 ? '#ee9a5d' : '#5cae92'}/></RoundedBox>
      <RoundedBox position={[0, .67, -.28]} args={[.52, .6, .3]} radius={.055} castShadow>
        <meshStandardMaterial color="#f3cb7d"/></RoundedBox>
      <mesh position={[0, 1.12, 0]} castShadow><sphereGeometry args={[.29, 16, 12]}/><meshStandardMaterial color="#34495e" metalness={.2}/></mesh>
      <mesh position={[0, 1.13, .255]}><boxGeometry args={[.37, .16, .06]}/>
        <meshStandardMaterial color="#9cd5e0" transparent opacity={.68}/></mesh>
      {leaving && <RoundedBox position={[0, .39, .43]} args={[.28, .25, .28]} radius={.035}>
        <meshStandardMaterial color="#dfb579"/></RoundedBox>}
    </group>
    <group position={[0, 1.58, 0]} visible={!selected}>
      <SceneLabel title={order.id} subtitle={leaving ? 'Saindo com o pedido' : `Motoboy na retirada · min ${minute}`} />
    </group>
  </group>;
}
