import { Suspense, useEffect, useMemo, useRef } from 'react';
import type { ComponentRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { ContactShadows, OrbitControls } from '@react-three/drei';
import { OrthographicCamera, Vector3 } from 'three';
import type { Order, ReplayEvent } from '../types/api.ts';
import type { LiveOrder } from '../simulation/live.ts';
import type { CrewActivities } from '../simulation/crew.ts';
import { CrewNavigator } from '../simulation/navigation.ts';
import type { Destinations } from '../simulation/navigation.ts';
import { parcelPosition } from '../simulation/parcelPlacement.ts';
import type { Zone } from '../simulation/replay.ts';
import { ZONE_POSITIONS } from '../simulation/replay.ts';
import Restaurant from './environment/Restaurant.tsx';
import Monster from './characters/Monster.tsx';
import KitchenCook from './characters/KitchenCook.tsx';
import { cookState } from '../simulation/visualRoles.ts';
import type { MonsterId } from './characters/roster.ts';
import OrderParcel from './orders/OrderParcel.tsx';
import LiveOrderParcel from './orders/LiveOrderParcel.tsx';
import LiveCourier from './couriers/LiveCourier.tsx';

function ContextGuard({ onLost }: { onLost: () => void }) {
  const { gl } = useThree();
  useEffect(() => {
    const lost = (event: Event) => { event.preventDefault(); onLost(); };
    gl.domElement.addEventListener('webglcontextlost', lost);
    return () => gl.domElement.removeEventListener('webglcontextlost', lost);
  }, [gl, onLost]);
  return null;
}

// Read-only scene diagnostics for development E2E tests. Never enabled in a production build.
// Use the public R3F store API instead of importing its unsupported `_roots` internals.
function SceneTestProbe() {
  const getState = useThree(state => state.get);
  const frames = useRef(0);
  useFrame(() => { frames.current += 1; });
  useEffect(() => {
    const testWindow = window as typeof window & {
      __rescueosSceneProbe?: () => {
        frame: number; camera: number[]; canvasSize: [number, number];
        crew: { id: string; position: number[]; transforms: number[][] }[];
      };
    };
    const readScene = () => {
      const state = getState();
      const controls = state.controls as { target?: Vector3 } | null;
      if (!controls?.target) throw new Error('OrbitControls not ready');
      const camera = state.camera as OrthographicCamera;
      const crew = (['scout', 'fixer', 'trace', 'runner', 'coordinator'] as const).map(id => {
        const root = state.scene.getObjectByName(`mascot-${id}`);
        if (!root) throw new Error(`Missing mascot ${id}`);
        const transforms: number[][] = [];
        root.traverse(part => transforms.push([
          ...part.position.toArray(), part.rotation.x, part.rotation.y, part.rotation.z, ...part.scale.toArray(),
        ]));
        return { id, position: root.position.toArray(), transforms };
      });
      return {
        frame: frames.current,
        canvasSize: [state.size.width, state.size.height] as [number, number],
        camera: [...camera.position.toArray(), ...camera.quaternion.toArray(), ...controls.target.toArray(), camera.zoom],
        crew,
      };
    };
    testWindow.__rescueosSceneProbe = readScene;
    return () => {
      if (testWindow.__rescueosSceneProbe === readScene) delete testWindow.__rescueosSceneProbe;
    };
  }, [getState]);
  return null;
}

function CameraRig({ focus, reduced, resetRequest, rotationRequest }: { focus: Zone | null; reduced: boolean; resetRequest: number; rotationRequest: number }) {
  const { camera, size } = useThree();
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null), moving = useRef(true);
  const target = useMemo(() => new Vector3(...(focus ? ZONE_POSITIONS[focus] : [0, 0, 0] as const)).setY(focus ? .35 : 0), [focus]);
  const cameraTarget = useMemo(() => target.clone().add(new Vector3(10, 11, 12)), [target]);
  const resetZoom = useRef(true), defaultZoom = Math.max(18, Math.min(85, Math.min(size.width / 14.2, size.height / 10.3) * (focus ? 1.12 : 1)));
  const previousRotation = useRef(rotationRequest);
  useEffect(() => {
    if (!controls.current || previousRotation.current === rotationRequest) return;
    const direction = Math.sign(rotationRequest - previousRotation.current);
    previousRotation.current = rotationRequest;
    moving.current = false; resetZoom.current = false;
    const pivot = controls.current.target;
    camera.position.sub(pivot).applyAxisAngle(new Vector3(0, 1, 0), direction * Math.PI / 2).add(pivot);
    controls.current.update();
  }, [camera, rotationRequest]);
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
    minZoom={18} maxZoom={85} minPolarAngle={.12} maxPolarAngle={1.48}
    minDistance={5} maxDistance={40} onStart={() => {
      moving.current = false; resetZoom.current = false;
      if (controls.current) controls.current.enableDamping = !reduced;
    }} />;
}

function NavigationDriver({ navigator, destinations, reduced, running, speed }: { navigator: CrewNavigator; destinations: Destinations; reduced: boolean; running: boolean; speed: number }) {
  // Um controlador por cena resolve as colisões entre todos os personagens antes das animações.
  useFrame((_, delta) => navigator.tick(destinations, delta * speed, reduced, !running), -1);
  return null;
}

export default function RestaurantScene({ orders, selected, selectedMonster, onOrder, onMonster, focus, onFocus, reduced,
  events, diagnostics, resetRequest, rotationRequest = 0, onContextLost, alerted, liveOrders, selectedLive, onLiveOrder, crew, simulationRunning = false, motionSpeed = 1, liveMinute = 0, kitchenFault = false, selectedCook = false, onCook }: {
  orders: Order[]; selected: string; selectedMonster: MonsterId | null; onOrder: (id: string) => void;
  onMonster: (id: MonsterId) => void; focus: Zone | null; onFocus: (zone: Zone) => void; reduced: boolean;
  events: ReplayEvent[]; diagnostics: number; resetRequest: number; rotationRequest?: number; onContextLost: () => void;
  alerted: string | null; liveOrders?: LiveOrder[]; selectedLive?: string; onLiveOrder?: (id: string) => void;
  crew?: CrewActivities; simulationRunning?: boolean; motionSpeed?: number; liveMinute?: number; kitchenFault?: boolean;
  selectedCook?: boolean; onCook?: () => void;
}) {
  const active = orders.find(order => order.order_id === selected);
  const applied = new Set(active?.applied_event_ids);
  const courierPresent = events.some(event => applied.has(event.event_id) && event.type === 'COURIER_ARRIVED')
    && !events.some(event => applied.has(event.event_id) && event.type === 'PICKED_UP');
  const preparingCount = liveOrders?.filter(order => order.status === 'PREPARING').length ?? 0;
  const kitchenActive = liveOrders ? preparingCount > 0 : orders.some(order => order.status === 'PREPARING');
  const cook = cookState(preparingCount, kitchenFault);
  const liveRunner = liveOrders?.some(order => order.status === 'PICKED_UP') ?? false;
  const liveWaiting = liveOrders?.some(order => order.status === 'READY') ?? false;
  const liveQueue = liveOrders?.some(order => order.status === 'QUEUED') ?? false;
  const positions: Record<MonsterId, [number, number, number]> = {
    scout: [-.1, .16, -.3], fixer: [-2.1, .16, -1.7], trace: [-1.65, .16, 2.1],
    runner: liveOrders ? liveRunner ? [4.0, .16, 2.2] : liveWaiting ? [2.4, .16, .25] : [4.0, .16, 2.2]
      : courierPresent ? [2.4, .16, .25] : [4.0, .16, 2.2],
    coordinator: liveQueue ? [-.7, .16, 1.1] : [.8, .16, 2.9],
  };
  const destinations = (crew ? Object.fromEntries(
    (Object.keys(positions) as MonsterId[]).map(id => [id, crew[id].position]),
  ) as Destinations : positions);
  // Hooks antes de renderizar Canvas: a mesma instância de navegação persiste durante a simulação.
  const navigator = useMemo(() => new CrewNavigator(destinations), []);
  const liveSlots: Partial<Record<LiveOrder['status'], number>> = {};
  const visibleOrders = liveOrders ? [
    ...liveOrders.filter(order => order.status !== 'PICKED_UP' && order.status !== 'DELIVERED'),
    ...liveOrders.filter(order => order.status === 'DELIVERED').slice(-2),
  ] : [];
  const parcels = visibleOrders
    .flatMap(order => {
      const slot = liveSlots[order.status] ?? 0;
      liveSlots[order.status] = slot + 1;
      const location = parcelPosition(order.status, slot);
      return location ? [{ order, location }] : [];
    }) ?? [];
  const courierOrders = liveOrders?.filter(order =>
    order.courierArrivedAt !== null && (order.pickedUpAt === null || liveMinute - order.pickedUpAt < 3))
    .slice(0, 3) ?? [];
  return <Suspense fallback={<div className="scene-loading">Pré-aquecendo o restaurante…</div>}>
    <Canvas shadows orthographic camera={{ position: [10, 11, 12], zoom: 57, near: .1, far: 100 }}
      dpr={[1, 1.5]} gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      aria-label="Restaurante 3D interativo da simulação RescueOS">
      <ContextGuard onLost={onContextLost} />
      {import.meta.env.DEV && new URLSearchParams(window.location.search).has('sceneProbe') && <SceneTestProbe />}
      <ambientLight intensity={.55} color="#edf4ee" />
      <hemisphereLight args={['#e7f3ef', '#65746d', .95]} />
      <directionalLight position={[-4, 11, 6]} intensity={2.7} color="#ffe2b5" castShadow
        shadow-mapSize={[1024, 1024]} shadow-camera-left={-9} shadow-camera-right={9}
        shadow-camera-top={9} shadow-camera-bottom={-9} shadow-bias={-.0005} />
      <pointLight position={[-2, 3, -2]} intensity={7} color="#ffcf8c" distance={8} />
      <pointLight position={[3, 3, 2]} intensity={5} color="#88d1dc" distance={7} />
      <directionalLight position={[6, 5, -5]} intensity={1.1} color="#b7e6ef" />
      <Restaurant focus={focus} onFocus={onFocus} kitchenActive={kitchenActive && !kitchenFault} diagnostics={diagnostics} openView={liveOrders !== undefined} />
      {liveOrders && <NavigationDriver navigator={navigator} destinations={destinations} reduced={reduced} running={simulationRunning} speed={motionSpeed} />}
      {liveOrders !== undefined && onCook && <KitchenCook mode={cook.mode} selected={selectedCook} reduced={reduced}
        running={simulationRunning} speed={motionSpeed} onSelect={onCook}/>}
      {(Object.keys(positions) as MonsterId[]).map(id => <Monster key={id} id={id} position={crew?.[id].position ?? positions[id]}
        activity={crew?.[id]} navigation={liveOrders ? navigator : undefined} selected={selectedMonster === id} reduced={reduced} onSelect={onMonster} />)}
      {liveOrders !== undefined && onLiveOrder
        ? parcels.map(({ order, location }) => <LiveOrderParcel key={order.id} order={order} position={location}
            selected={selectedLive === order.id} reduced={reduced} onSelect={onLiveOrder} />) : null}
      {liveOrders !== undefined && onLiveOrder && courierOrders.map((order, index) =>
        <LiveCourier key={order.id} order={order} index={index} minute={liveMinute} selected={selectedLive === order.id}
          reduced={reduced} running={simulationRunning} onSelect={onLiveOrder}/>)}
      {liveOrders !== undefined && kitchenFault && <pointLight position={[-2.8, 2.4, -1.7]} color="#ff5749" intensity={3} distance={4}/>}
      {orders.map((order, index) => <OrderParcel key={order.order_id} order={order} offset={index}
        alerted={alerted === order.order_id}
        selected={selected === order.order_id} reduced={reduced} onSelect={onOrder} />)}
      <ContactShadows position={[0, -.55, 0]} opacity={.3} scale={17} blur={2.5} far={6} resolution={256} frames={1} />
      <CameraRig focus={focus} reduced={reduced} resetRequest={resetRequest} rotationRequest={rotationRequest} />
    </Canvas>
  </Suspense>;
}
