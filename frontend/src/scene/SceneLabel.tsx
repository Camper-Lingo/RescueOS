import { useEffect, useMemo } from 'react';
import { CanvasTexture, SRGBColorSpace } from 'three';

/** Rótulo desenhado localmente: sem fontes externas e sem raízes DOM dentro do Canvas. */
export default function SceneLabel({ title, subtitle = '', selected = false }: { title: string; subtitle?: string; selected?: boolean }) {
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 96;
    const context = canvas.getContext('2d');
    if (context) {
      context.fillStyle = '#20383a'; context.strokeStyle = selected ? '#daf6cb' : '#71978c'; context.lineWidth = selected ? 5 : 2;
      context.beginPath(); context.roundRect(3, 3, 250, 90, 15); context.fill(); context.stroke();
      context.textAlign = 'center'; context.fillStyle = '#f1f4e7'; context.font = '600 25px Segoe UI, sans-serif';
      context.fillText(title, 128, subtitle ? 40 : 57, 230);
      if (subtitle) { context.font = '20px Segoe UI, sans-serif'; context.fillStyle = '#bedad1'; context.fillText(subtitle, 128, 72, 230); }
    }
    const result = new CanvasTexture(canvas); result.colorSpace = SRGBColorSpace;
    return result;
  }, [title, subtitle, selected]);
  useEffect(() => () => texture.dispose(), [texture]);
  return <sprite scale={[1.35, .51, 1]} renderOrder={100}><spriteMaterial map={texture} transparent depthTest={false} depthWrite={false} /></sprite>;
}
