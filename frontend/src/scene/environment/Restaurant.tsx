import { RoundedBox } from '@react-three/drei';
import type { Zone } from '../../simulation/replay.ts';
import SceneLabel from '../SceneLabel.tsx';

function Box({ at, size, color, radius = .08 }: { at: [number, number, number]; size: [number, number, number]; color: string; radius?: number }) {
  return <RoundedBox args={size} radius={radius} smoothness={2} position={at} castShadow receiveShadow><meshStandardMaterial color={color} roughness={.83} /></RoundedBox>;
}
function Plant({ at }: { at: [number, number, number] }) {
  return <group position={at}>
    <mesh castShadow><cylinderGeometry args={[.16, .12, .25, 8]} /><meshStandardMaterial color="#cb8668" /></mesh>
    {[0, 1, 2, 3].map(i => <mesh key={i} position={[Math.sin(i * 1.6) * .11, .22 + i * .03, Math.cos(i * 1.6) * .09]} scale={[.13, .28, .1]} rotation={[.25, i * 1.6, .3]} castShadow><sphereGeometry args={[1, 6, 6]} /><meshStandardMaterial color={i % 2 ? '#639888' : '#8eae80'} /></mesh>)}
  </group>;
}

export default function Restaurant({ focus, onFocus, kitchenActive, diagnostics }: {
  focus: Zone | null; onFocus: (zone: Zone) => void; kitchenActive: boolean; diagnostics: number;
}) {
  return <group>
    <Box at={[0, -.25, 0]} size={[10.5, .5, 7.9]} radius={.24} color="#243845" />
    <Box at={[0, .035, 0]} size={[10.1, .13, 7.5]} radius={.15} color="#e9dec9" />
    <Box at={[0, -.42, 0]} size={[10.1, .13, 7.5]} radius={.15} color="#c89669" />
    <Box at={[-2.55, .12, -1.5]} size={[4.6, .035, 3.8]} color={focus === 'kitchen' ? '#edbf86' : '#eed8b6'} />
    <Box at={[2.55, .12, -1.5]} size={[4.55, .035, 3.8]} color={focus === 'pickup' ? '#95c9be' : '#b4d0c0'} />
    <Box at={[-2.8, .12, 2.2]} size={[3.95, .035, 2.55]} color={focus === 'incident' ? '#b6a8cd' : '#d4cbd9'} />
    <Box at={[2.7, .12, 2.45]} size={[4.1, .035, 2.05]} color={focus === 'command' ? '#a8c8d5' : '#bed0d2'} />
    {[-4, -3, -2, -1, 0, 1, 2, 3, 4].map(x => <mesh key={x} position={[x, .145, -.8]}><boxGeometry args={[.018, .006, 5.4]} /><meshStandardMaterial color="#e3d2b6" /></mesh>)}
    <Box at={[0, .91, -3.55]} size={[10, 1.75, .18]} color="#f2e5ce" />
    <Box at={[-4.95, .65, -.7]} size={[.18, 1.2, 5.5]} color="#efe0c3" />
    <Box at={[0, 1.8, -3.55]} size={[10.05, .13, .24]} color="#c99e73" />
    <Box at={[-4.95, 1.29, -.7]} size={[.24, .12, 5.5]} color="#c99e73" />
    <Box at={[-2.6, .61, -2.75]} size={[4.15, .92, .9]} color="#43616b" />
    <Box at={[-2.6, 1.1, -2.75]} size={[4.3, .13, 1.02]} color="#faf1d9" />
    <Box at={[-4.25, .61, -1.9]} size={[.85, .92, 1.15]} color="#43616b" />
    <Box at={[-4.25, 1.1, -1.9]} size={[.98, .13, 1.2]} color="#faf1d9" />
    {[-3.7, -2.7, -1.7].map(x => <Box key={x} at={[x, .79, -2.278]} size={[.3, .035, .035]} color="#d4ae78" radius={.01} />)}
    <Box at={[-3.1, 1.19, -2.75]} size={[1.5, .08, .75]} color="#243d49" radius={.04} />
    {[-1, 1].flatMap(x => [-1, 1].map(z => <mesh key={`${x}-${z}`} rotation={[-Math.PI / 2, 0, 0]} position={[-3.1 + x * .37, 1.235, -2.75 + z * .2]}><torusGeometry args={[.12, .025, 6, 16]} /><meshStandardMaterial color="#f2ab65" emissive="#f5a954" emissiveIntensity={kitchenActive ? .8 : .05} /></mesh>))}
    <mesh position={[-3.45, 1.42, -2.55]} castShadow><cylinderGeometry args={[.21, .19, .33, 12]} /><meshStandardMaterial color="#bdc9c2" metalness={.45} roughness={.4} /></mesh>
    <Box at={[-3.1, 2.52, -2.8]} size={[1.9, .36, 1.04]} color="#6f898b" radius={.1} />
    <Box at={[-3.1, 2.91, -3.05]} size={[.6, .5, .5]} color="#8a9d9b" radius={.03} />
    {[0, 1, 2, 3].map(i => <mesh key={i} position={[-1.2, 1.2 + i * .045, -2.7]}><cylinderGeometry args={[.2, .2, .028, 16]} /><meshStandardMaterial color="#fbf0d8" /></mesh>)}
    <Plant at={[-4.35, 1.27, -1.5]} />
    <Box at={[2.3, .6, -1.1]} size={[3.2, .88, 1]} color="#b98966" />
    <Box at={[2.3, 1.1, -1.1]} size={[3.4, .15, 1.1]} color="#365760" />
    {[1.05, 1.45, 1.85, 2.25, 2.65, 3.05, 3.45].map(x => <Box key={x} at={[x, .6, -.58]} size={[.035, .65, .04]} color="#dab58a" radius={.01} />)}
    <mesh position={[3.5, 1.26, -1.05]} castShadow><sphereGeometry args={[.11, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2]} /><meshStandardMaterial color="#e4b974" metalness={.6} roughness={.35} /></mesh>
    {[1.7, 3.7].map(x => <Box key={x} at={[x, 1.05, -3.05]} size={[.1, 1.8, .15]} color="#ac8668" radius={.02} />)}
    {[.55, 1.18, 1.82].map(y => <Box key={y} at={[2.7, y, -3.05]} size={[2.3, .1, .66]} color="#bd9675" radius={.03} />)}
    <Plant at={[3.2, 2.01, -3.05]} />
    <Box at={[2.2, 1.39, -3.05]} size={[.4, .33, .3]} color="#f4e9d2" />
    <Box at={[-3.1, .55, 2.3]} size={[2.5, .78, 1.18]} color="#485365" />
    <Box at={[-3.1, .99, 2.3]} size={[2.62, .1, 1.3]} color="#f0e4d4" />
    <Box at={[-3.25, 1.42, 2.07]} size={[1.25, .72, .12]} color="#354858" />
    <Box at={[-3.25, 1.44, 2.15]} size={[1.08, .55, .025]} color={diagnostics ? '#c68d6e' : '#817ba3'} radius={.03} />
    {[-.25, 0, .25].map(x => <Box key={x} at={[-3.25 + x, 1.44, 2.18]} size={[.13, .25 + x, .015]} color="#cec6ef" radius={.01} />)}
    <Box at={[2.5, .55, 2.45]} size={[2.3, .78, 1.15]} color="#456574" />
    <Box at={[2.5, .99, 2.45]} size={[2.45, .11, 1.25]} color="#e6d8c0" />
    <Box at={[2.5, 1.27, 2.2]} size={[1.3, .4, .08]} color="#6aabae" />
    {[2.1, 2.5, 2.9].map(x => <mesh key={x} position={[x, 1.04, 2.6]}><cylinderGeometry args={[.07, .07, .015, 12]} /><meshStandardMaterial color="#88dbc9" emissive="#65a7a7" emissiveIntensity={.2} /></mesh>)}
    {[.35, 1.65].map(z => <Box key={z} at={[4.65, 1.07, z]} size={[.16, 1.85, .16]} color="#6ea998" radius={.07} />)}
    <Box at={[4.65, 2.03, 1]} size={[.2, .19, 1.5]} color="#91d3b2" />
    <Plant at={[4.4, .3, 2.65]} />
    {[-1.4, .7].map(x => <group key={x} position={[x, 2.1, -2.7]}>
      <mesh position={[0, .45, 0]}><cylinderGeometry args={[.015, .015, .9, 6]} /><meshStandardMaterial color="#55636a" /></mesh>
      <mesh><sphereGeometry args={[.18, 12, 8]} /><meshStandardMaterial color="#ffdda4" emissive="#ffd699" emissiveIntensity={.7} /></mesh>
    </group>)}
    {([
      ['kitchen', [-2.4, .17, -.5], '01 · COZINHA'], ['pickup', [2.2, .17, -.1], '02 · RETIRADA'],
      ['incident', [-3.1, .17, 3.1], '03 · EVIDÊNCIAS'], ['command', [2.6, .17, 3.3], '04 · OPERAÇÕES'],
    ] as [Zone, [number, number, number], string][]).map(([zone, position, label]) => <group key={zone} position={position}
      onClick={event => { event.stopPropagation(); onFocus(zone); }}><SceneLabel title={label} selected={focus === zone} /></group>)}
  </group>;
}
