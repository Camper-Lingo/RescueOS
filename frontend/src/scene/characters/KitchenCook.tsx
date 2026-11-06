import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { RoundedBox } from '@react-three/drei';
import { Group, MathUtils } from 'three';
import type { CookMode } from '../../simulation/visualRoles.ts';
import SceneLabel from '../SceneLabel.tsx';

interface Props {
  mode: CookMode;
  selected: boolean;
  reduced: boolean;
  running: boolean;
  speed: number;
  onSelect: () => void;
}

/** Funcionário visual: não conta como sexto agente e não executa LLM.
 * Idle, preparo e falha seguem o estado real do motor sintético.
 */
export default function KitchenCook({ mode, selected, reduced, running, speed, onSelect }: Props) {
  const root = useRef<Group>(null);
  const body = useRef<Group>(null);
  const head = useRef<Group>(null);
  const left = useRef<Group>(null);
  const right = useRef<Group>(null);
  const phase = useRef(0);
  const weights = useRef({ cooking: 0, fault: 0 });
  useEffect(() => () => { document.body.style.cursor = ''; }, []);

  useFrame((_, delta) => {
    if (!root.current || !body.current || !head.current || !left.current || !right.current) return;
    const dt = Math.min(delta, .05);
    if (reduced) {
      root.current.rotation.y = 0;
      body.current.position.y = 0;
      body.current.rotation.z = 0;
      head.current.rotation.z = 0;
      left.current.rotation.set(0, 0, 0);
      right.current.rotation.set(0, 0, 0);
      return;
    }
    // Pausa significa congelar o funcionário, não continuar animando o expediente.
    if (!running) return;
    phase.current += dt * Math.min(Math.max(speed, 1), 2);
    weights.current.cooking = MathUtils.damp(weights.current.cooking, mode === 'cooking' ? 1 : 0, 6, dt);
    weights.current.fault = MathUtils.damp(weights.current.fault, mode === 'fault' ? 1 : 0, 6, dt);
    const { cooking, fault } = weights.current;
    const idle = 1 - Math.max(cooking, fault);
    const t = phase.current;
    body.current.position.y = Math.sin(t * (2 + cooking * 2)) * (.015 + cooking * .016);
    body.current.rotation.z = idle * Math.sin(t * .8) * .03 + fault * .09;
    head.current.rotation.z = Math.sin(t * .68) * .045 * idle + fault * -.19;
    left.current.rotation.x = MathUtils.damp(left.current.rotation.x,
      cooking * (.38 + Math.sin(t * 6) * .38) + fault * -.5 + idle * Math.sin(t * .7) * .035, 12, dt);
    right.current.rotation.x = MathUtils.damp(right.current.rotation.x,
      cooking * (.4 - Math.sin(t * 6 + .8) * .38) + fault * -.35, 12, dt);
    left.current.rotation.z = MathUtils.damp(left.current.rotation.z, fault * .55, 8, dt);
    right.current.rotation.z = MathUtils.damp(right.current.rotation.z, fault * -.65, 8, dt);
  });

  return <group name="cozinheiro-simulado" position={[-3.0, .15, -1.83]}
    userData={{ role: 'cozinheiro-visual', mode }}>
    <group ref={root}
      onClick={event => { event.stopPropagation(); onSelect(); }}
      onPointerOver={() => { document.body.style.cursor = 'pointer'; }}
      onPointerOut={() => { document.body.style.cursor = ''; }}>
      <group ref={body}>
        <mesh position={[0, .11, 0]} castShadow>
          <cylinderGeometry args={[.22, .27, .18, 9]}/><meshStandardMaterial color="#4f7280"/>
        </mesh>
        <RoundedBox args={[.48, .59, .38]} position={[0, .52, 0]} radius={.16} castShadow>
          <meshStandardMaterial color="#e7a36d" roughness={.86}/>
        </RoundedBox>
        <RoundedBox args={[.30, .45, .035]} position={[0, .46, .211]} radius={.05}>
          <meshStandardMaterial color="#f5ead6"/>
        </RoundedBox>
        <group ref={left} position={[-.27, .73, -.02]}>
          <mesh position={[0, -.19, 0]} castShadow>
            <capsuleGeometry args={[.095, .27, 5, 8]}/><meshStandardMaterial color="#e7a36d"/>
          </mesh>
          <mesh position={[0, -.36, 0]}>
            <sphereGeometry args={[.105, 9, 7]}/><meshStandardMaterial color="#f4c49b"/>
          </mesh>
        </group>
        <group ref={right} position={[.27, .73, -.02]}>
          <mesh position={[0, -.19, 0]} castShadow>
            <capsuleGeometry args={[.095, .27, 5, 8]}/><meshStandardMaterial color="#e7a36d"/>
          </mesh>
          <mesh position={[0, -.36, 0]}>
            <sphereGeometry args={[.105, 9, 7]}/><meshStandardMaterial color="#f4c49b"/>
          </mesh>
        </group>
        <group ref={head} position={[0, 1.04, .03]}>
          <mesh castShadow>
            <sphereGeometry args={[.25, 16, 12]}/><meshStandardMaterial color="#f4c49b"/>
          </mesh>
          {[-.095, .095].map(x => <mesh key={x} position={[x, .035, .23]}>
            <sphereGeometry args={[.031, 8, 6]}/><meshBasicMaterial color="#263847"/>
          </mesh>)}
          <mesh position={[0, -.09, .242]} rotation={[0, 0, Math.PI / 2]}>
            <capsuleGeometry args={[.018, .055, 4, 8]}/><meshBasicMaterial color="#8f5347"/>
          </mesh>
          {/* Touca alta, reconhecível de longe e por qualquer ângulo. */}
          <mesh position={[0, .245, 0]} castShadow>
            <cylinderGeometry args={[.29, .27, .13, 12]}/><meshStandardMaterial color="#f6f6ef"/>
          </mesh>
          <mesh position={[0, .42, 0]} castShadow>
            <cylinderGeometry args={[.24, .20, .29, 12]}/><meshStandardMaterial color="#fffdf3"/>
          </mesh>
        </group>
      </group>
      {/* Clique fácil mesmo com a câmera afastada. */}
      <mesh position={[0, .77, 0]}>
        <boxGeometry args={[.75, 1.62, .65]}/><meshBasicMaterial transparent opacity={0} depthWrite={false}/>
      </mesh>
      {selected && <mesh position={[0, .018, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[.38, .48, 32]}/><meshBasicMaterial color="#fff0a8" side={2}/>
      </mesh>}
      {selected && <group position={[0, 1.9, 0]}>
        <SceneLabel title="Cozinheiro" selected subtitle={mode === 'fault' ? 'Cozinha parada' : mode === 'cooking' ? 'Preparando comida' : 'Aguardando pedidos'}/>
      </group>}
    </group>
  </group>;
}
