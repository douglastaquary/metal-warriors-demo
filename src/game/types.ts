import type { Vfx } from '../graphics/Vfx';
import type { Level } from '../levels/Level';
import type { AudioSystem } from '../systems/AudioSystem';
import type { Projectiles } from '../entities/Projectiles';
import type { Player } from '../entities/Player';

export interface Intent {
  x: number;
  y: number;
  jumpHeld: boolean;
  jumpPressed: boolean;
  fireHeld: boolean;
  saberPressed: boolean;
  shieldHeld: boolean;
}

export function emptyIntent(): Intent {
  return { x: 0, y: 0, jumpHeld: false, jumpPressed: false, fireHeld: false, saberPressed: false, shieldHeld: false };
}

export interface GameContext {
  level: Level;
  vfx: Vfx;
  audio: AudioSystem;
  projectiles: Projectiles;
  player: Player;
  rng: () => number;
  time: number;
  shake(amount: number): void;
  hitstop(ms: number): void;
  flash(color: string, strength: number): void;
  addScore(points: number, x: number, y: number): void;
  spawnDrone(x: number, y: number): void;
  enemyKilled(): void;
}
