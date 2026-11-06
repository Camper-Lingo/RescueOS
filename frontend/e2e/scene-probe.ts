import type { Page } from '@playwright/test';

export interface SceneSnapshot {
  frame: number;
  canvasSize: [number, number]; // R3F canvas size in CSS pixels
  camera: number[]; // position(3), quaternion(4), OrbitControls target(3), orthographic zoom(1)
  crew: { id: string; position: number[]; transforms: number[][] }[];
}

/** Read-only, dev-only scene hook enabled by ?sceneProbe=1. */
export async function sceneState(page: Page): Promise<SceneSnapshot> {
  // Canvas can become visible before its R3F children mount and their effects
  // register the probe. Wait for the scene AND OrbitControls to be ready.
  await page.waitForFunction(() => {
    const probe = (window as typeof window & { __rescueosSceneProbe?: () => SceneSnapshot }).__rescueosSceneProbe;
    if (!probe) return false;
    try {
      const scene = probe();
      return scene.frame > 1 && scene.camera.length === 11 && scene.crew.length === 5
        && scene.canvasSize.length === 2 && scene.canvasSize.every(value => value > 0);
    } catch {
      return false;
    }
  }, undefined, { timeout: 15_000 });
  return page.evaluate(() => {
    const probe = (window as typeof window & { __rescueosSceneProbe?: () => SceneSnapshot }).__rescueosSceneProbe;
    if (!probe) throw new Error('Scene E2E probe disappeared after initialization');
    return probe();
  });
}

export function cameraDifference(left: number[], right: number[]): number {
  if (left.length !== 11 || right.length !== 11) throw new Error('Unexpected camera snapshot');
  return Math.max(...left.map((value, index) => Math.abs(value - right[index])));
}
