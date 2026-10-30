import { Suspense, useEffect, useMemo, useRef } from 'react';
import type { ComponentRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { ContactShadows, OrbitControls } from '@react-three/drei';
import { OrthographicCamera, Vector3 } from 'three';
import type { Order, ReplayEvent } from '../types/api.ts';
import type { Zone } from '../simulation/replay.ts';
import { ZONE_POSITIONS } from '../simulation/replay.ts';
import Restaurant from './environment/Restaurant.tsx';
import Monster from './characters/Monster.tsx';
import type { MonsterId } from './characters/roster.ts';
import OrderParcel from './orders/OrderParcel.tsx';

function ContextGuard({ onLost }: { onLost: () => void }) {
  const { gl } = useThree();
  useEffect(() => {
    const lost = (event: Event) => { event.preventDefault(); onLost(); };
    gl.domElement.addEventListener('webglcontextlost', lost);
    return () => gl.domElement.removeEventListener('webglcontextlost', lost);
  }, [gl, onLost]);
  return null;
}

function CameraRig({ focus, reduced, resetRequest }: { focus: Zone | null; reduced: boolean; resetRequest: number }) {
  const { camera, size } = useThree();
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null), moving = useRef(true);
  const target = useMemo(() => new Vector3(...(focus ? ZONE_POSITIONS[focus] : [0, 0, 0] as const)).setY(focus ? .35 : 0), [focus]);
  const cameraTarget = useMemo(() => target.clone().add(new Vector3(10, 11, 12)), [target]);
  const resetZoom = useRef(true), defaultZoom = Math.max(18, Math.min(85, Math.min(size.width / 14.2, size.height / 10.3) * (focus ? 1.12 : 1)));
  useEffect(() => { resetZoom.current = true; moving.current = true; }, [focus, reduced]);
  useEffect(() => {
    resetZoom.current = true; moving.current = true;
  }, [resetRequest, size.width, size.height]);
  useFrame((_, delta) => {
    if (!controls.current || !moving.current) return;
    // Eliminar inércia da órbita durante o comando de foco/reset.
    controls.current.enableDamping = false;
    controls.current.update();
    if (reduced) { camera.position.copy(cameraTarget); controls.current.target.copy(target); moving.current = false; }
    else {
      const amount = 1 - Math.exp(-delta * 4);
      camera.position.lerp(cameraTarget, amount); controls.current.target.lerp(target, amount);
      if (camera.position.distanceTo(cameraTarget) < .002 && controls.current.target.distanceTo(target) < .002
        && (!resetZoom.current || Math.abs(camera.zoom - defaultZoom) < .002)) {
        camera.position.copy(cameraTarget); controls.current.target.copy(target); moving.current = false;
      }
    }
    if (resetZoom.current && camera instanceof OrthographicCamera) {
      camera.zoom = reduced || !moving.current ? defaultZoom : camera.zoom + (defaultZoom - camera.zoom) * (1 - Math.exp(-delta * 4));
      camera.updateProjectionMatrix();
    }
    controls.current.update();
    if (!moving.current) { resetZoom.current = false; controls.current.enableDamping = !reduced; }
  });
  return <OrbitControls ref={controls} makeDefault enablePan={false} enableDamping={!reduced}
    minZoom={18} maxZoom={85} minPolarAngle={.65} maxPolarAngle={1.1}
    minAzimuthAngle={.1} maxAzimuthAngle={1.25} onStart={() => {
      moving.current = false; resetZoom.current = false;
      if (controls.current) controls.current.enableDamping = !reduced;
    }} />;
}

export default function RestaurantScene({ orders, selected, selectedMonster, onOrder, onMonster, focus, onFocus, reduced,
  events, diagnostics, resetRequest, onContextLost }: {
  orders: Order[]; selected: string; selectedMonster: MonsterId | null; onOrder: (id: string) => void;
  onMonster: (id: MonsterId) => void; focus: Zone | null; onFocus: (zone: Zone) => void; reduced: boolean;
  events: ReplayEvent[]; diagnostics: number; resetRequest: number; onContextLost: () => void;
}) {
  const active = orders.find(order => order.order_id === selected);
  const applied = new Set(active?.applied_event_ids);
  const courierPresent = events.some(event => applied.has(event.event_id) && event.type === 'COURIER_ARRIVED')
    && !events.some(event => applied.has(event.event_id) && event.type === 'PICKED_UP');
  const kitchenActive = orders.some(order => order.status === 'PREPARING');
  const positions: Record<MonsterId, [number, number, number]> = {
    scout: [-.1, .16, -.3], fixer: [-2.1, .16, -1.7], trace: [-1.65, .16, 2.1],
    runner: courierPresent ? [2.4, .16, .25] : [4.0, .16, 2.2], coordinator: [.8, .16, 2.9],
  };
  return <Suspense fallback={<div className="scene-loading">Pré-aquecendo o restaurante…</div>}>
    <Canvas shadows orthographic camera={{ position: [10, 11, 12], zoom: 57, near: .1, far: 100 }}
      dpr={[1, 1.5]} gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      aria-label="Restaurante 3D interativo da simulação RescueOS">
      <ContextGuard onLost={onContextLost} />
      <ambientLight intensity={.55} color="#edf4ee" />
      <hemisphereLight args={['#e7f3ef', '#65746d', .95]} />
      <directionalLight position={[-4, 11, 6]} intensity={2.7} color="#ffe2b5" castShadow
        shadow-mapSize={[1024, 1024]} shadow-camera-left={-9} shadow-camera-right={9}
        shadow-camera-top={9} shadow-camera-bottom={-9} shadow-bias={-.0005} />
      <pointLight position={[-2, 3, -2]} intensity={7} color="#ffcf8c" distance={8} />
      <pointLight position={[3, 3, 2]} intensity={5} color="#88d1dc" distance={7} />
      <directionalLight position={[6, 5, -5]} intensity={1.1} color="#b7e6ef" />
      <Restaurant focus={focus} onFocus={onFocus} kitchenActive={kitchenActive} diagnostics={diagnostics} />
      {(Object.keys(positions) as MonsterId[]).map(id => <Monster key={id} id={id} position={positions[id]}
        selected={selectedMonster === id} reduced={reduced} onSelect={onMonster} />)}
      {orders.map((order, index) => <OrderParcel key={order.order_id} order={order} offset={index}
        selected={selected === order.order_id} reduced={reduced} onSelect={onOrder} />)}
      <ContactShadows position={[0, -.55, 0]} opacity={.3} scale={17} blur={2.5} far={6} resolution={256} frames={1} />
      <CameraRig focus={focus} reduced={reduced} resetRequest={resetRequest} />
    </Canvas>
  </Suspense>;
}
