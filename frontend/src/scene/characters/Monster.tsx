import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { RoundedBox } from '@react-three/drei';
import { Group, MathUtils, Vector3 } from 'three';

import { MONSTERS } from './roster.ts';
import type { MonsterId } from './roster.ts';
import type { CrewActivity } from '../../simulation/crew.ts';
import { chooseMotionMode, idleMicroGesture, smoothMotionWeight } from '../../simulation/crewMotion.ts';
import type { CrewNavigator } from '../../simulation/navigation.ts';
import SceneLabel from '../SceneLabel.tsx';

interface Props { id: MonsterId; position: [number, number, number]; activity?: CrewActivity; navigation?: CrewNavigator; selected: boolean; reduced: boolean; onSelect: (id: MonsterId) => void }

export default function Monster({ id, position, activity, navigation, selected, reduced, onSelect }: Props) {
  const monster = MONSTERS.find(item => item.id === id)!;
  const index = MONSTERS.findIndex(item => item.id === id);
  const root = useRef<Group>(null), body = useRef<Group>(null), eyes = useRef<Group>(null), feet = useRef<Group>(null), arms = useRef<Group>(null);
  // Pesos da FSM suavizados; não reiniciam quando as tarefas mudam.
  const poseWeights = useRef({ idle: 1, walk: 0, work: 0, react: 0 });
  const initial = useRef(position);
  const target = useMemo(() => new Vector3(...position), [position[0], position[1], position[2]]);
  const destination = useMemo(() => new Vector3(), []);
  useEffect(() => () => { document.body.style.cursor = ''; }, []);
  useFrame(({ clock }, delta) => {
    if (!root.current || !body.current || !eyes.current || !feet.current || !arms.current) return;
    const t = clock.elapsedTime + index * 1.37;
    destination.copy(target);
    if (navigation) {
      destination.x = navigation.positions[id].x;
      destination.z = navigation.positions[id].z;
    } else if (!reduced && id === 'scout') {
      destination.x += Math.sin(t * .42) * .24;
      destination.z += Math.cos(t * .42) * .18;
    }
    const dx = destination.x - root.current.position.x, dz = destination.z - root.current.position.z;
    const moving = Math.abs(dx) + Math.abs(dz) > .015;
    if (navigation || reduced) root.current.position.copy(destination);
    else root.current.position.lerp(destination, 1 - Math.exp(-delta * 5));
    const phase = chooseMotionMode(activity?.action ?? 'idle', activity?.busy ?? false, moving, reduced);
    const weights = poseWeights.current;
    for (const key of ['idle', 'walk', 'work', 'react'] as const) {
      weights[key] = smoothMotionWeight(weights[key], phase === key ? 1 : 0, delta);
    }
    const idle = idleMicroGesture(id, t);
    const walk = Math.sin(t * 10);
    const breath = Math.sin(t * (id === 'coordinator' ? 1.5 : id === 'fixer' ? 2.6 : 2));
    const work = Math.sin(t * (id === 'fixer' ? 8 : id === 'scout' ? 4 : 3.5));
    const react = Math.sin(t * 7 + index);
    const idleW = weights.idle, walkW = weights.walk, workW = weights.work, reactW = weights.react;
    body.current.position.y = reduced ? 0 : breath * .018 + idleW * idle.sway + walkW * Math.abs(walk) * .075
      + workW * Math.abs(work) * .035 + reactW * Math.abs(react) * .065;
    body.current.position.x = reduced ? 0 : idleW * idle.sway * .65 + walkW * Math.sin(t * 5) * .017;
    const targetScale = selected ? 1.07 : 1;
    const scale = MathUtils.damp(body.current.scale.x, targetScale + (reduced ? 0 : reactW * Math.abs(react) * .025), 7, delta);
    body.current.scale.setScalar(scale);
    body.current.rotation.z = reduced ? 0 : idleW * idle.sway + walkW * -walk * .045
      + reactW * react * .07 + (id === 'trace' ? Math.sin(t * .85) * .018 : 0);
    body.current.rotation.x = reduced ? 0 : workW * Math.sin(t * 2) * .035 + reactW * Math.sin(t * 4) * .045;
    const blink = (t % (4.3 + index * .3)) / .18;
    eyes.current.scale.y = !reduced && blink < 1 ? .12 + Math.abs(Math.cos(blink * Math.PI)) * .88 : 1;
    eyes.current.rotation.y = reduced ? 0 : idleW * idle.glance + reactW * Math.sin(t * 3) * .08;
    eyes.current.rotation.z = reduced ? 0 : idleW * Math.sin(t * .33) * .055 + reactW * react * .05;
    for (let side = 0; side < 2; side++) {
      const step = Math.sin(t * 10 + side * Math.PI);
      const workArm = activity?.action === 'assign' ? (side === 0 ? -.48 : .18 + .12 * work)
        : activity?.action === 'carry' ? -.55 + .09 * work
        : activity?.action === 'inspect' ? (side === 0 ? -.55 : -.12)
        : .12 * work;
      const reactArm = activity?.action === 'repair' ? Math.sin(t * 9 + side * 2) * .68
        : activity?.action === 'scan' ? (side === 0 ? -.62 : Math.sin(t * 3) * .3)
        : .28 * react;
      feet.current.children[side].rotation.x = reduced ? 0 : walkW * step * .38 + idleW * (side === 0 ? idle.toe : 0);
      arms.current.children[side].rotation.x = reduced ? 0 : walkW * -step * .33 + idleW * (side === 0 ? idle.wave : -idle.wave * .3)
        + workW * workArm + reactW * reactArm;
      arms.current.children[side].rotation.z = reduced ? 0 : idleW * Math.sin(t * .6 + side) * .03
        + reactW * (side === 0 ? -.12 : .12);
    }
    const restYaw = .3 + (reduced ? 0 : idleW * idle.glance * .35);
    root.current.rotation.y = reduced ? .3 : MathUtils.damp(root.current.rotation.y, moving ? Math.atan2(dx, dz) : restYaw, 5, delta);
  });
  const c = monster.color;
  return <group ref={root} name={`mascot-${id}`} position={navigation ? [navigation.positions[id].x, .16, navigation.positions[id].z] : initial.current} onClick={event => { event.stopPropagation(); onSelect(id); }}
    onPointerOver={() => { document.body.style.cursor = 'pointer'; }} onPointerOut={() => { document.body.style.cursor = ''; }}>
    {activity?.busy && <group position={[0, 1.13, 0]} name={`${id}-working-indicator`}>
      <mesh><sphereGeometry args={[.085, 10, 8]}/><meshBasicMaterial color={c} /></mesh>
      <mesh position={[0, -.16, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[.13, .18, 20]}/><meshBasicMaterial color={c} transparent opacity={.65}/>
      </mesh>
    </group>}
    {selected && activity && <group position={[0, 1.65, 0]}>
      <SceneLabel title={monster.name} subtitle={activity.title} selected />
    </group>}
    {selected && <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, .08, 0]}><ringGeometry args={[.5, .56, 32]} /><meshBasicMaterial color={c} transparent opacity={.8} /></mesh>}
    <group ref={feet} name={`${id}-feet`}>
      {[-1, 1].map(sign => <mesh key={sign} position={[sign * .18, .13, .1]} castShadow><capsuleGeometry args={[.105, .13, 3, 6]} /><meshStandardMaterial color={id === 'fixer' ? '#344a57' : c} roughness={.8} /></mesh>)}
    </group>
    <group ref={body} name={`${id}-body`}>
      {id === 'fixer' || id === 'coordinator'
        ? <RoundedBox args={[.7, .65, .57]} radius={.2} smoothness={3} position={[0, .52, 0]} castShadow><meshStandardMaterial color={c} roughness={.72} /></RoundedBox>
        : <mesh position={[0, .52, 0]} castShadow scale={id === 'trace' ? [1.08, .9, .96] : id === 'runner' ? [.83, 1.06, .85] : [1, 1, 1]}>
          <capsuleGeometry args={[.32, .17, 5, 12]} /><meshStandardMaterial color={c} roughness={.7} /></mesh>}
      <group ref={eyes} name={`${id}-eyes`} position={[0, .58, .265]}>
        {[-1, 1].map(sign => <group key={sign} position={[sign * .125, 0, 0]}>
          <mesh scale={[.1, .13, .06]}><sphereGeometry args={[1, 12, 10]} /><meshStandardMaterial color="#fff7e9" /></mesh>
          <mesh position={[.015, -.005, .055]} scale={[.045, .064, .025]}><sphereGeometry args={[1, 10, 8]} /><meshStandardMaterial color="#172b3c" /></mesh>
          <mesh position={[.027, .018, .076]}><sphereGeometry args={[.014, 6, 6]} /><meshBasicMaterial color="white" /></mesh>
        </group>)}
      </group>
      <mesh position={[0, .41, .303]} rotation={[0, 0, Math.PI]}><torusGeometry args={[.055, .012, 5, 12, Math.PI]} /><meshStandardMaterial color="#375162" /></mesh>
      {(id === 'scout' || id === 'trace') && <group position={[.14, .92, 0]}>
        <mesh><cylinderGeometry args={[.025, .025, .2, 6]} /><meshStandardMaterial color="#344f60" /></mesh>
        <mesh position={[0, .13, 0]}><sphereGeometry args={[id === 'scout' ? .09 : .065, 10, 8]} /><meshStandardMaterial color={c} emissive={c} emissiveIntensity={.4} /></mesh>
      </group>}
      {id === 'scout' && <RoundedBox args={[.25, .18, .1]} position={[.31, .55, 0]} radius={.04}><meshStandardMaterial color="#355065" /></RoundedBox>}
      {id === 'scout' && <RoundedBox args={[.24, .09, .035]} position={[0, .31, .29]} radius={.025}><meshStandardMaterial color="#d0f3ec" emissive="#83bbb5" emissiveIntensity={.2} /></RoundedBox>}
      {id === 'trace' && <group position={[-.13, .58, .35]}>
        <mesh><torusGeometry args={[.15, .032, 6, 20]} /><meshStandardMaterial color="#50446b" metalness={.3} /></mesh>
        <mesh position={[0, 0, .005]}><circleGeometry args={[.12, 20]} /><meshStandardMaterial color="#b9e2e6" transparent opacity={.22} roughness={.25} /></mesh>
      </group>}
      {(id === 'fixer' || id === 'runner') && <RoundedBox args={[.44, .43, .2]} radius={.075} position={[0, .5, -.32]} castShadow>
        <meshStandardMaterial color={id === 'fixer' ? '#dc715d' : '#4d947f'} roughness={.8} /></RoundedBox>}
      {id === 'fixer' && [-1, 1].map(sign => <mesh key={sign} position={[sign * .24, .9, 0]} rotation={[0, 0, -sign * .3]}><coneGeometry args={[.07, .18, 6]} /><meshStandardMaterial color="#ffd0a0" /></mesh>)}
      {id === 'fixer' && <RoundedBox args={[.4, .2, .035]} position={[0, .3, .29]} radius={.04}><meshStandardMaterial color="#f3dfba" roughness={.9} /></RoundedBox>}
      {id === 'runner' && <group position={[0, .93, 0]}>
        <mesh><sphereGeometry args={[.32, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2]} /><meshStandardMaterial color="#4f8e7a" roughness={.7} /></mesh>
        <RoundedBox args={[.48, .055, .25]} position={[0, .025, .2]} radius={.025}><meshStandardMaterial color="#a9dbbd" /></RoundedBox>
      </group>}
      {id === 'coordinator' && <group>
        <mesh position={[0, .78, 0]}><torusGeometry args={[.34, .045, 6, 20, Math.PI]} /><meshStandardMaterial color="#293e59" /></mesh>
        {[-1, 1].map(sign => <mesh key={sign} position={[sign * .36, .6, 0]}><sphereGeometry args={[.09, 10, 8]} /><meshStandardMaterial color="#314660" /></mesh>)}
        <RoundedBox args={[.2, .035, .035]} radius={.01} position={[.27, .43, .25]}><meshStandardMaterial color="#26374a" /></RoundedBox>
        <RoundedBox args={[.24, .3, .055]} radius={.025} position={[.4, .34, .21]} rotation={[.2, -.2, -.15]}><meshStandardMaterial color="#293f54" /></RoundedBox>
      </group>}
      {id === 'fixer' && activity?.action === 'repair' && <group name="fixer-repair-tool" position={[.42, .33, .33]} rotation={[.1, 0, -.6]}>
        <mesh position={[0, .18, 0]}><cylinderGeometry args={[.04, .04, .36, 8]}/><meshStandardMaterial color="#d5dce0" metalness={.7} roughness={.28}/></mesh>
        <mesh position={[0, .4, 0]} rotation={[0, 0, .6]}><boxGeometry args={[.24, .07, .08]}/>
          <meshStandardMaterial color="#8abdd0" metalness={.65} roughness={.3}/></mesh>
      </group>}
      {id === 'scout' && activity?.action === 'scan' && <group name="scout-warning" position={[0, 1.11, 0]}>
        <mesh><octahedronGeometry args={[.15]}/><meshStandardMaterial color="#ffae61" emissive="#e85e24" emissiveIntensity={1}/></mesh>
      </group>}
      {id === 'trace' && activity?.action === 'inspect' && <group name="trace-records" position={[.31, .38, .37]} rotation={[-.2, .2, -.2]}>
        <RoundedBox args={[.28, .36, .045]} radius={.025}><meshStandardMaterial color="#9edbe7" roughness={.65}/></RoundedBox>
        <mesh position={[0, .06, .027]}><boxGeometry args={[.19, .025, .008]}/><meshBasicMaterial color="#29485e"/></mesh>
        <mesh position={[0, -.03, .027]}><boxGeometry args={[.18, .025, .008]}/><meshBasicMaterial color="#29485e"/></mesh>
      </group>}
      {id === 'runner' && activity?.carrying && <group name="runner-carrying-order" position={[.03, .39, .44]}>
        <RoundedBox args={[.32, .24, .29]} radius={.025} castShadow>
          <meshStandardMaterial color="#e9bd79" roughness={.85} />
        </RoundedBox>
        <mesh position={[0, .13, 0]}>
          <boxGeometry args={[.065, .012, .29]}/><meshStandardMaterial color="#f5dfb6"/>
        </mesh>
      </group>}
      <group ref={arms}>
        {[-1, 1].map(sign => <group key={sign} position={[sign * .36, .5, 0]}>
          <mesh position={[0, -.1, 0]} rotation={[0, 0, sign * .45]} castShadow><capsuleGeometry args={[.065, .14, 3, 6]} /><meshStandardMaterial color={c} roughness={.8} /></mesh>
        </group>)}
      </group>
    </group>
  </group>;
}
