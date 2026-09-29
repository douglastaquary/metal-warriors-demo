import * as THREE from 'three';
import { createSeededRandom } from '../utils/random';

export const PALETTE = {
  nitroHull: '#d8482a',
  nitroHullDark: '#8f2a1c',
  nitroArmor: '#e9a45c',
  joint: '#39405a',
  jointDark: '#1f2336',
  trim: '#f4c430',
  glass: '#38e0e8',
  saber: '#7ff7ff',
  enemyHull: '#7b52c4',
  enemyArmor: '#b690e8',
  enemyDark: '#2e2350',
  enemyEye: '#ff3d8b',
  bossHull: '#3d2c62',
  bossArmor: '#d0364e',
  steel: '#56668c',
  steelDark: '#262d48',
  steelDeep: '#141a2e',
  rust: '#c9683a',
  rustDark: '#7e3620',
  hazard: '#f2b92a',
  plasmaPlayer: '#8ffcff',
  plasmaEnemy: '#ff5fb0',
  plasmaGreen: '#7dff6a',
  energy: '#5cff9d',
} as const;

let gradientMap: THREE.DataTexture | null = null;

export function toonGradient(): THREE.DataTexture {
  if (gradientMap) return gradientMap;
  const steps = [70, 130, 195, 255];
  const data = new Uint8Array(steps.length * 4);
  steps.forEach((v, i) => {
    data[i * 4] = v;
    data[i * 4 + 1] = v;
    data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  });
  gradientMap = new THREE.DataTexture(data, steps.length, 1, THREE.RGBAFormat);
  gradientMap.minFilter = THREE.NearestFilter;
  gradientMap.magFilter = THREE.NearestFilter;
  gradientMap.generateMipmaps = false;
  gradientMap.needsUpdate = true;
  return gradientMap;
}

export function toon(color: THREE.ColorRepresentation, options: { emissive?: THREE.ColorRepresentation; emissiveIntensity?: number; map?: THREE.Texture } = {}): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({
    color,
    gradientMap: toonGradient(),
    emissive: options.emissive ?? '#000000',
    emissiveIntensity: options.emissiveIntensity ?? 1,
    map: options.map ?? null,
  });
}

export function glow(color: THREE.ColorRepresentation, intensity = 2.2): THREE.MeshBasicMaterial {
  const c = new THREE.Color(color).multiplyScalar(intensity);
  return new THREE.MeshBasicMaterial({ color: c, toneMapped: false });
}

type Draw = (ctx: CanvasRenderingContext2D, w: number, h: number, rnd: () => number) => void;

export function pixelTexture(w: number, h: number, seed: number, draw: Draw): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable for texture generation.');
  ctx.imageSmoothingEnabled = false;
  draw(ctx, w, h, createSeededRandom(seed));
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

function rect(ctx: CanvasRenderingContext2D, color: string, x: number, y: number, w: number, h: number): void {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

function bevel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, light: string, dark: string): void {
  rect(ctx, light, x, y, w, 1);
  rect(ctx, light, x, y, 1, h);
  rect(ctx, dark, x, y + h - 1, w, 1);
  rect(ctx, dark, x + w - 1, y, 1, h);
}

function speckle(ctx: CanvasRenderingContext2D, rnd: () => number, w: number, h: number, color: string, count: number): void {
  ctx.fillStyle = color;
  for (let i = 0; i < count; i += 1) ctx.fillRect(Math.floor(rnd() * w), Math.floor(rnd() * h), 1, 1);
}

export interface TextureKit {
  steel: THREE.CanvasTexture;
  steelTop: THREE.CanvasTexture;
  rust: THREE.CanvasTexture;
  hazard: THREE.CanvasTexture;
  grate: THREE.CanvasTexture;
  wall: THREE.CanvasTexture;
  wallDeep: THREE.CanvasTexture;
  electric: THREE.CanvasTexture;
  planet: THREE.CanvasTexture;
  shipHull: THREE.CanvasTexture;
  crate: THREE.CanvasTexture;
  mechDecal: THREE.CanvasTexture;
  enemyDecal: THREE.CanvasTexture;
  wallPanorama: THREE.CanvasTexture;
  furnace: THREE.CanvasTexture;
  reactorPanel: THREE.CanvasTexture;
  column: THREE.CanvasTexture;
}

let kit: TextureKit | null = null;

export function textures(): TextureKit {
  if (kit) return kit;
  kit = {
    steel: pixelTexture(16, 16, 11, (ctx, w, h, rnd) => {
      rect(ctx, '#3a4566', 0, 0, w, h);
      rect(ctx, '#465479', 1, 1, w - 2, h - 2);
      bevel(ctx, 1, 1, w - 2, h - 2, '#6f80a8', '#232a44');
      rect(ctx, '#2b3352', 0, 7, w, 1);
      rect(ctx, '#58688f', 0, 8, w, 1);
      for (const [x, y] of [[3, 3], [12, 3], [3, 12], [12, 12]]) {
        rect(ctx, '#8b9cc4', x, y, 1, 1);
        rect(ctx, '#1e2438', x + 1, y + 1, 1, 1);
      }
      speckle(ctx, rnd, w, h, 'rgba(20,24,40,0.5)', 10);
    }),
    steelTop: pixelTexture(16, 16, 12, (ctx, w, h, rnd) => {
      rect(ctx, '#465479', 0, 0, w, h);
      rect(ctx, '#7a8bb4', 0, 0, w, 2);
      rect(ctx, '#2a3150', 0, 2, w, 1);
      for (let x = 1; x < w; x += 4) rect(ctx, '#34405f', x, 5, 2, 8);
      bevel(ctx, 0, 3, w, h - 3, '#5d6d95', '#1f2640');
      speckle(ctx, rnd, w, h, 'rgba(20,24,40,0.5)', 8);
    }),
    rust: pixelTexture(16, 16, 13, (ctx, w, h, rnd) => {
      rect(ctx, '#b75a33', 0, 0, w, h);
      bevel(ctx, 0, 0, w, h, '#e48a55', '#5f2716');
      rect(ctx, '#8e3f22', 2, 2, w - 4, h - 4);
      bevel(ctx, 2, 2, w - 4, h - 4, '#6d2f19', '#d7784a');
      rect(ctx, '#c9683a', 4, 4, w - 8, h - 8);
      for (const [x, y] of [[1, 1], [14, 1], [1, 14], [14, 14]]) rect(ctx, '#ffd09a', x, y, 1, 1);
      speckle(ctx, rnd, w, h, 'rgba(60,20,10,0.6)', 14);
    }),
    hazard: pixelTexture(16, 16, 14, (ctx, w, h) => {
      rect(ctx, '#1b1b22', 0, 0, w, h);
      for (let y = 0; y < h; y += 1) {
        for (let x = 0; x < w; x += 1) {
          if (((x + y) >> 2) % 2 === 0) rect(ctx, '#f2b92a', x, y, 1, 1);
        }
      }
      bevel(ctx, 0, 0, w, h, '#fff1a8', '#3a2a08');
    }),
    grate: pixelTexture(16, 16, 15, (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      rect(ctx, '#e0873f', 0, 0, w, 3);
      rect(ctx, '#ffc27a', 0, 0, w, 1);
      rect(ctx, '#6a2d14', 0, 3, w, 1);
      for (let x = 0; x < w; x += 4) {
        rect(ctx, '#9e4a24', x, 4, 1, 8);
        rect(ctx, '#9e4a24', x, 4, 4, 1);
      }
      rect(ctx, '#b8592b', 0, 11, w, 2);
      rect(ctx, '#5a240f', 0, 13, w, 1);
    }),
    wall: pixelTexture(64, 64, 16, (ctx, w, h, rnd) => {
      // Neutral greys: each section tints the wall with its own palette.
      rect(ctx, '#2e2f36', 0, 0, w, h);
      for (let y = 0; y < h; y += 16) {
        for (let x = 0; x < w; x += 32) {
          rect(ctx, '#383a44', x + 1, y + 1, 30, 14);
          bevel(ctx, x + 1, y + 1, 30, 14, '#565a68', '#1a1b21');
        }
      }
      // Window strip with alpha holes that reveal space behind the wall.
      ctx.clearRect(6, 20, 20, 12);
      ctx.clearRect(38, 20, 20, 12);
      bevel(ctx, 5, 19, 22, 14, '#848898', '#121318');
      bevel(ctx, 37, 19, 22, 14, '#848898', '#121318');
      rect(ctx, '#848898', 15, 20, 2, 12);
      rect(ctx, '#848898', 47, 20, 2, 12);
      // Pipes and vents.
      rect(ctx, '#5c5f6c', 0, 44, w, 4);
      rect(ctx, '#8e92a2', 0, 44, w, 1);
      rect(ctx, '#202127', 0, 47, w, 1);
      for (let x = 4; x < w; x += 16) rect(ctx, '#b0b4c2', x, 43, 2, 6);
      for (let x = 8; x < 28; x += 3) rect(ctx, '#18191e', x, 54, 2, 6);
      rect(ctx, '#34d6ff', 50, 55, 3, 2);
      rect(ctx, '#ff5a3c', 56, 55, 3, 2);
      speckle(ctx, rnd, w, h, 'rgba(0,0,0,0.35)', 60);
    }),
    wallDeep: pixelTexture(64, 64, 17, (ctx, w, h, rnd) => {
      rect(ctx, '#121831', 0, 0, w, h);
      for (let x = 0; x < w; x += 16) {
        rect(ctx, '#19213f', x + 2, 0, 12, h);
        rect(ctx, '#232d55', x + 2, 0, 1, h);
      }
      for (let y = 6; y < h; y += 20) {
        rect(ctx, '#2a3563', 0, y, w, 2);
        rect(ctx, '#0b0f20', 0, y + 2, w, 1);
      }
      for (let i = 0; i < 8; i += 1) rect(ctx, rnd() > 0.5 ? '#ffb347' : '#3fe0ff', Math.floor(rnd() * w), Math.floor(rnd() * h), 2, 1);
    }),
    electric: pixelTexture(16, 16, 18, (ctx, w, h, rnd) => {
      rect(ctx, '#0a0f24', 0, 0, w, h);
      ctx.fillStyle = '#6ff3ff';
      let y = 8;
      for (let x = 0; x < w; x += 1) {
        y = Math.max(2, Math.min(h - 3, y + Math.floor(rnd() * 5) - 2));
        ctx.fillRect(x, y, 1, 1);
        if (rnd() > 0.6) ctx.fillRect(x, y + 1, 1, 1);
      }
      ctx.fillStyle = '#c8b0ff';
      for (let x = 0; x < w; x += 1) {
        if (rnd() > 0.7) ctx.fillRect(x, Math.floor(rnd() * h), 1, 1);
      }
    }),
    planet: pixelTexture(128, 64, 19, (ctx, w, h, rnd) => {
      rect(ctx, '#2e6fb3', 0, 0, w, h);
      for (let i = 0; i < 70; i += 1) {
        const x = Math.floor(rnd() * w);
        const y = Math.floor(rnd() * h);
        const s = 3 + Math.floor(rnd() * 12);
        rect(ctx, rnd() > 0.4 ? '#3f9a5a' : '#c9a86a', x, y, s, Math.max(2, s >> 1));
      }
      for (let i = 0; i < 40; i += 1) {
        rect(ctx, 'rgba(240,250,255,0.85)', Math.floor(rnd() * w), Math.floor(rnd() * h), 6 + Math.floor(rnd() * 16), 2);
      }
    }),
    shipHull: pixelTexture(32, 16, 20, (ctx, w, h, rnd) => {
      rect(ctx, '#7c8cb0', 0, 0, w, h);
      for (let x = 0; x < w; x += 8) bevel(ctx, x, 0, 8, h, '#b4c2e0', '#3c4868');
      rect(ctx, '#3c4868', 0, 7, w, 2);
      for (let i = 0; i < 10; i += 1) rect(ctx, '#ffe39a', Math.floor(rnd() * w), 10 + Math.floor(rnd() * 4), 1, 1);
    }),
    crate: pixelTexture(16, 16, 21, (ctx, w, h) => {
      rect(ctx, '#5b6a52', 0, 0, w, h);
      bevel(ctx, 0, 0, w, h, '#96a784', '#262e22');
      rect(ctx, '#3f4a38', 2, 2, w - 4, h - 4);
      rect(ctx, '#f2b92a', 2, 6, w - 4, 4);
      for (let x = 2; x < w - 2; x += 4) rect(ctx, '#1b1b22', x, 6, 2, 4);
      rect(ctx, '#c9d6b6', 3, 3, 3, 1);
    }),
    mechDecal: pixelTexture(16, 16, 22, (ctx, w, h) => {
      rect(ctx, '#ffffff', 0, 0, w, h);
      rect(ctx, '#d9d9d9', 0, 0, w, 1);
      rect(ctx, '#a8a8a8', 0, h - 2, w, 2);
      rect(ctx, '#b8b8b8', 0, 7, w, 1);
      rect(ctx, '#f4c430', 2, 10, 5, 2);
      rect(ctx, '#ffffff', 9, 10, 1, 2);
      rect(ctx, '#ffffff', 11, 10, 1, 2);
    }),
    enemyDecal: pixelTexture(16, 16, 23, (ctx, w, h) => {
      rect(ctx, '#ffffff', 0, 0, w, h);
      rect(ctx, '#cfcfcf', 0, 5, w, 1);
      rect(ctx, '#cfcfcf', 0, 11, w, 1);
      rect(ctx, '#9a9a9a', 0, h - 1, w, 1);
      rect(ctx, '#ff3d8b', 6, 7, 4, 3);
    }),
    wallPanorama: pixelTexture(64, 64, 24, (ctx, w, h) => {
      rect(ctx, '#1d2440', 0, 0, w, h);
      ctx.clearRect(3, 6, 58, 40);
      bevel(ctx, 2, 5, 60, 42, '#7f8fc0', '#0c0f1c');
      rect(ctx, '#3a4670', 31, 6, 2, 40);
      rect(ctx, '#3a4670', 3, 25, 58, 2);
      rect(ctx, '#5d6c9e', 31, 6, 1, 40);
      rect(ctx, '#5d6c9e', 3, 25, 58, 1);
      rect(ctx, '#2a3356', 0, 50, w, 14);
      bevel(ctx, 0, 50, w, 14, '#44507c', '#10142a');
      for (let x = 4; x < w; x += 8) rect(ctx, '#f2b92a', x, 56, 4, 2);
    }),
    furnace: pixelTexture(32, 32, 25, (ctx, w, h, rnd) => {
      rect(ctx, '#2b1a18', 0, 0, w, h);
      bevel(ctx, 0, 0, w, h, '#6b3b2a', '#0d0706');
      rect(ctx, '#ff7a2a', 4, 8, w - 8, h - 14);
      for (let y = 8; y < h - 6; y += 3) rect(ctx, '#ffd066', 4, y, w - 8, 1);
      for (let x = 4; x < w - 4; x += 4) rect(ctx, '#3a1e14', x, 8, 1, h - 14);
      rect(ctx, '#1a0f0c', 2, 2, w - 4, 4);
      for (let i = 0; i < 6; i += 1) rect(ctx, '#fff1b0', 5 + Math.floor(rnd() * (w - 10)), 10 + Math.floor(rnd() * (h - 18)), 1, 1);
    }),
    reactorPanel: pixelTexture(32, 32, 26, (ctx, w, h) => {
      rect(ctx, '#123238', 0, 0, w, h);
      bevel(ctx, 0, 0, w, h, '#2e7a80', '#061416');
      for (let y = 4; y < h; y += 8) {
        rect(ctx, '#0a2226', 3, y, w - 6, 4);
        rect(ctx, '#4dffe0', 5, y + 1, 6, 2);
        rect(ctx, '#1f9a8a', 13, y + 1, 14, 2);
      }
    }),
    column: pixelTexture(16, 32, 27, (ctx, w, h) => {
      rect(ctx, '#3a4566', 0, 0, w, h);
      rect(ctx, '#6f80a8', 1, 0, 2, h);
      rect(ctx, '#1b2138', w - 3, 0, 2, h);
      for (let y = 2; y < h; y += 8) {
        rect(ctx, '#56668c', 4, y, w - 8, 4);
        rect(ctx, '#8b9cc4', 4, y, w - 8, 1);
        rect(ctx, '#1e2438', 5, y + 1, 1, 2);
        rect(ctx, '#1e2438', w - 6, y + 1, 1, 2);
      }
    }),
  };
  return kit;
}
