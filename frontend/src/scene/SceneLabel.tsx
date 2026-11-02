import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { CanvasTexture, OrthographicCamera, Sprite, SRGBColorSpace } from 'three';

/** Rótulo desenhado localmente: sem fontes externas e sem raízes DOM dentro do Canvas. */
export default function SceneLabel({ title, subtitle = '', selected = false, variant = 'parcel' }: {
  title: string; subtitle?: string; selected?: boolean; variant?: 'parcel' | 'zone';
}) {
  const marker = selected && variant === 'parcel', sprite = useRef<Sprite>(null);
  useFrame(({ camera }) => {
    // O marcador contextual deve continuar legível ao afastar a câmera ou no mobile.
    if (marker && sprite.current && camera instanceof OrthographicCamera) sprite.current.scale.set(124 / camera.zoom, 54 / camera.zoom, 1);
  });
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 96;
    const context = canvas.getContext('2d');
    if (context) {
      const expanded = variant === 'parcel' && selected;
      context.fillStyle = marker ? '#192e33' : selected ? '#315b50' : '#192e33'; context.strokeStyle = marker ? '#efbd68' : selected ? '#caf1d5' : '#6d8e8a'; context.lineWidth = selected ? 4 : 2;
      context.beginPath(); context.roundRect(3, expanded ? 3 : 20, 250, expanded ? 78 : 56, 12); context.fill(); context.stroke();
      context.fillStyle = selected ? '#bdebd2' : '#a9c6bc'; context.fillRect(16, expanded ? 17 : 35, 3, expanded ? 60 : 26);
      context.textAlign = 'center'; context.fillStyle = '#f1f4e7'; context.font = `600 ${variant === 'zone' ? 22 : 26}px Segoe UI, sans-serif`;
      if (marker) {
        context.font = '18px Segoe UI, sans-serif'; context.fillStyle = '#efbd68'; context.fillText('Selecionado', 133, 23);
        context.beginPath(); context.moveTo(117, 81); context.lineTo(139, 81); context.lineTo(128, 94); context.closePath(); context.fill();
        context.font = '600 26px Segoe UI, sans-serif'; context.fillStyle = '#f1f4e7';
      }
      context.fillText(title, 133, expanded ? 49 : 56, 218);
      if (expanded && subtitle) { context.font = '17px Segoe UI, sans-serif'; context.fillStyle = '#bedad1'; context.fillText(subtitle, 133, 70, 218); }
    }
    const result = new CanvasTexture(canvas); result.colorSpace = SRGBColorSpace;
    return result;
  }, [title, subtitle, selected, variant]);
  useEffect(() => () => texture.dispose(), [texture]);
  return <sprite ref={sprite} name={marker ? `parcel-highlight-${title}` : undefined} scale={[variant === 'zone' ? 1.5 : selected ? 1.42 : 1.25, .49, 1]} renderOrder={marker ? 101 : 100}><spriteMaterial map={texture} transparent depthTest={false} depthWrite={false} /></sprite>;
}
