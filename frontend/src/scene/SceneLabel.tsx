import { useEffect, useMemo } from 'react';
import { CanvasTexture, SRGBColorSpace } from 'three';

/** Rótulo desenhado localmente: sem fontes externas e sem raízes DOM dentro do Canvas. */
export default function SceneLabel({ title, subtitle = '', selected = false, variant = 'parcel' }: {
  title: string; subtitle?: string; selected?: boolean; variant?: 'parcel' | 'zone';
}) {
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 96;
    const context = canvas.getContext('2d');
    if (context) {
      const expanded = variant === 'parcel' && selected;
      context.fillStyle = selected ? '#315b50' : '#192e33'; context.strokeStyle = selected ? '#caf1d5' : '#6d8e8a'; context.lineWidth = selected ? 4 : 2;
      context.beginPath(); context.roundRect(3, expanded ? 3 : 20, 250, expanded ? 90 : 56, 12); context.fill(); context.stroke();
      context.fillStyle = selected ? '#bdebd2' : '#a9c6bc'; context.fillRect(16, expanded ? 17 : 35, 3, expanded ? 60 : 26);
      context.textAlign = 'center'; context.fillStyle = '#f1f4e7'; context.font = `600 ${variant === 'zone' ? 22 : 26}px Segoe UI, sans-serif`;
      context.fillText(title, 133, expanded && subtitle ? 40 : 56, 218);
      if (expanded && subtitle) { context.font = '19px Segoe UI, sans-serif'; context.fillStyle = '#bedad1'; context.fillText(subtitle, 133, 72, 218); }
    }
    const result = new CanvasTexture(canvas); result.colorSpace = SRGBColorSpace;
    return result;
  }, [title, subtitle, selected, variant]);
  useEffect(() => () => texture.dispose(), [texture]);
  return <sprite scale={[variant === 'zone' ? 1.5 : selected ? 1.42 : 1.25, .49, 1]} renderOrder={100}><spriteMaterial map={texture} transparent depthTest={false} depthWrite={false} /></sprite>;
}
