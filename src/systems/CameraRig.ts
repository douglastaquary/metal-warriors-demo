import * as THREE from 'three';
import { VIEW_HEIGHT_UNITS } from '../core/Renderer';

const FOV = 30;
const DISTANCE = VIEW_HEIGHT_UNITS / 2 / Math.tan(THREE.MathUtils.degToRad(FOV / 2));

function noise(t: number, seed: number): number {
  const x = Math.sin(t * 12.9898 + seed * 78.233) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

export interface CameraBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export class CameraRig {
  readonly camera = new THREE.PerspectiveCamera(FOV, 16 / 9, 1, 260);
  private readonly focus = new THREE.Vector2();
  private lookahead = 0;
  private trauma = 0;
  private shakeTime = 0;
  private zoom = 1;
  private zoomTarget = 1;
  private readonly offset = new THREE.Vector2();
  reducedMotion = false;

  get distance(): number {
    return DISTANCE;
  }

  get fov(): number {
    return FOV;
  }

  get halfWidth(): number {
    return (VIEW_HEIGHT_UNITS / 2) * this.camera.aspect;
  }

  get position(): THREE.Vector3 {
    return this.camera.position;
  }

  addTrauma(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  setZoom(zoom: number, snap = false): void {
    this.zoomTarget = zoom;
    if (snap) this.zoom = zoom;
  }

  setOffset(x: number, y: number): void {
    this.offset.set(x, y);
  }

  snap(x: number, y: number, facing: number, bounds: CameraBounds): void {
    this.lookahead = facing * 2.2;
    this.focus.set(x + this.lookahead, y);
    this.clamp(bounds);
    this.apply(0, 0);
  }

  update(dt: number, x: number, y: number, facing: number, bounds: CameraBounds, pixelWorld: number): void {
    this.lookahead += (facing * 2.2 - this.lookahead) * Math.min(1, dt * 2.5);
    const tx = x + this.lookahead;
    const ty = y;
    this.focus.x += (tx - this.focus.x) * Math.min(1, dt * 7);
    this.focus.y += (ty - this.focus.y) * Math.min(1, dt * 4);
    this.zoom += (this.zoomTarget - this.zoom) * Math.min(1, dt * 4);
    this.clamp(bounds);
    this.apply(dt, pixelWorld);
  }

  private clamp(bounds: CameraBounds): void {
    const hw = this.halfWidth / this.zoom;
    const hh = VIEW_HEIGHT_UNITS / 2 / this.zoom;
    const minX = bounds.minX + hw;
    const maxX = bounds.maxX - hw;
    this.focus.x = minX > maxX ? (bounds.minX + bounds.maxX) / 2 : THREE.MathUtils.clamp(this.focus.x, minX, maxX);
    const minY = bounds.minY + hh;
    const maxY = bounds.maxY - hh;
    this.focus.y = minY > maxY ? (bounds.minY + bounds.maxY) / 2 : THREE.MathUtils.clamp(this.focus.y, minY, maxY);
  }

  private apply(dt: number, pixelWorld: number): void {
    this.shakeTime += dt;
    this.trauma = Math.max(0, this.trauma - dt * 1.5);
    const shake = this.reducedMotion ? 0 : this.trauma * this.trauma;
    let px = this.focus.x + this.offset.x;
    let py = this.focus.y + this.offset.y;
    if (pixelWorld > 0) {
      px = Math.round(px / pixelWorld) * pixelWorld;
      py = Math.round(py / pixelWorld) * pixelWorld;
    }
    const f = this.shakeTime * 30;
    this.camera.position.set(px + shake * 0.6 * noise(f, 1), py + shake * 0.5 * noise(f, 2), DISTANCE / this.zoom);
    this.camera.rotation.set(0, 0, shake * 0.03 * noise(f, 3));
  }
}
