import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { RoundedBox } from '@react-three/drei';
import { Group, MathUtils, Vector3 } from 'three';

import { MONSTERS } from './roster.ts';
import type { MonsterId } from './roster.ts';

interface Props { id: MonsterId; position: [number, number, number]; selected: boolean; reduced: boolean; onSelect: (id: MonsterId) => void }

export default function Monster({ id, position, selected, reduced, onSelect }: Props) {
  const monster = MONSTERS.find(item => item.id === id)!;
  const index = MONSTERS.findIndex(item => item.id === id);
  const root = useRef<Group>(null), body = useRef<Group>(null), eyes = useRef<Group>(null), feet = useRef<Group>(null);
  const initial = useRef(position);
  const target = useMemo(() => new Vector3(...position), [position[0], position[1], position[2]]);
  const destination = useMemo(() => new Vector3(), []);
  useEffect(() => () => { document.body.style.cursor = ''; }, []);
  useFrame(({ clock }, delta) => {
    if (!root.current || !body.current || !eyes.current || !feet.current) return;
    const t = clock.elapsedTime + index * 1.37;
    destination.copy(target);
    if (!reduced && id === 'scout') { destination.x += Math.sin(t * .42) * .24; destination.z += Math.cos(t * .42) * .18; }
    const dx = destination.x - root.current.position.x, dz = destination.z - root.current.position.z;
    const moving = Math.abs(dx) + Math.abs(dz) > .015;
    if (reduced) root.current.position.copy(destination);
    else root.current.position.lerp(destination, 1 - Math.exp(-delta * 5));
    body.current.position.y = reduced ? 0 : Math.sin(t * 2.3) * .025;
    body.current.scale.setScalar(selected ? 1.07 : 1);
    eyes.current.scale.y = !reduced && t % 4.8 < .13 ? .12 : 1;
    feet.current.rotation.z = !reduced && moving ? Math.sin(t * 11) * .1 : 0;
    root.current.rotation.y = reduced ? .3 : MathUtils.damp(root.current.rotation.y, moving ? Math.atan2(dx, dz) : .3, 5, delta);
  });
  const c = monster.color;
  return <group ref={root} position={initial.current} onClick={event => { event.stopPropagation(); onSelect(id); }}
    onPointerOver={() => { document.body.style.cursor = 'pointer'; }} onPointerOut={() => { document.body.style.cursor = ''; }}>
    {selected && <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, .08, 0]}><ringGeometry args={[.5, .56, 32]} /><meshBasicMaterial color={c} transparent opacity={.8} /></mesh>}
    <group ref={feet}>
      {[-1, 1].map(sign => <mesh key={sign} position={[sign * .17, .13, .08]} castShadow><capsuleGeometry args={[.095, .12, 3, 6]} /><meshStandardMaterial color={id === 'fixer' ? '#344a57' : c} roughness={.8} /></mesh>)}
    </group>
    <group ref={body}>
      {id === 'fixer' || id === 'coordinator'
        ? <RoundedBox args={[.7, .65, .57]} radius={.2} smoothness={3} position={[0, .52, 0]} castShadow><meshStandardMaterial color={c} roughness={.72} /></RoundedBox>
        : <mesh position={[0, .52, 0]} castShadow scale={id === 'trace' ? [1, .88, .92] : id === 'runner' ? [.83, 1, .85] : [1, 1, 1]}>
          <capsuleGeometry args={[.32, .17, 5, 12]} /><meshStandardMaterial color={c} roughness={.7} /></mesh>}
      <group ref={eyes} position={[0, .58, .265]}>
        {[-1, 1].map(sign => <group key={sign} position={[sign * .125, 0, 0]}>
          <mesh scale={[.1, .13, .06]}><sphereGeometry args={[1, 12, 10]} /><meshStandardMaterial color="#fff7e9" /></mesh>
          <mesh position={[.015, -.005, .055]} scale={[.045, .064, .025]}><sphereGeometry args={[1, 10, 8]} /><meshStandardMaterial color="#172b3c" /></mesh>
          <mesh position={[.027, .018, .076]}><sphereGeometry args={[.014, 6, 6]} /><meshBasicMaterial color="white" /></mesh>
        </group>)}
      </group>
      <mesh position={[0, .41, .303]} rotation={[0, 0, Math.PI]}><torusGeometry args={[.055, .012, 5, 12, Math.PI]} /><meshStandardMaterial color="#375162" /></mesh>
      {(id === 'scout' || id === 'trace') && <group position={[.14, .92, 0]}>
        <mesh><cylinderGeometry args={[.025, .025, .2, 6]} /><meshStandardMaterial color="#344f60" /></mesh>
        <mesh position={[0, .13, 0]}><sphereGeometry args={[.065, 10, 8]} /><meshStandardMaterial color={c} emissive={c} emissiveIntensity={.4} /></mesh>
      </group>}
      {id === 'scout' && <RoundedBox args={[.25, .18, .1]} position={[.31, .55, 0]} radius={.04}><meshStandardMaterial color="#355065" /></RoundedBox>}
      {id === 'trace' && <mesh position={[-.13, .58, .35]}><torusGeometry args={[.14, .028, 6, 20]} /><meshStandardMaterial color="#544372" metalness={.3} /></mesh>}
      {(id === 'fixer' || id === 'runner') && <RoundedBox args={[.44, .43, .2]} radius={.075} position={[0, .5, -.32]} castShadow>
        <meshStandardMaterial color={id === 'fixer' ? '#dc715d' : '#4d947f'} roughness={.8} /></RoundedBox>}
      {id === 'fixer' && [-1, 1].map(sign => <mesh key={sign} position={[sign * .24, .9, 0]} rotation={[0, 0, -sign * .3]}><coneGeometry args={[.07, .18, 6]} /><meshStandardMaterial color="#ffd0a0" /></mesh>)}
      {id === 'coordinator' && <group>
        <mesh position={[0, .78, 0]}><torusGeometry args={[.34, .045, 6, 20, Math.PI]} /><meshStandardMaterial color="#293e59" /></mesh>
        {[-1, 1].map(sign => <mesh key={sign} position={[sign * .36, .6, 0]}><sphereGeometry args={[.09, 10, 8]} /><meshStandardMaterial color="#314660" /></mesh>)}
        <RoundedBox args={[.2, .035, .035]} radius={.01} position={[.27, .43, .25]}><meshStandardMaterial color="#26374a" /></RoundedBox>
      </group>}
      {[-1, 1].map(sign => <mesh key={sign} position={[sign * .36, .4, 0]} rotation={[0, 0, sign * .45]} castShadow><capsuleGeometry args={[.065, .14, 3, 6]} /><meshStandardMaterial color={c} roughness={.8} /></mesh>)}
    </group>
  </group>;
}
