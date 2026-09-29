import type { PickupKind } from '../graphics/Props';

export const enum Tile {
  Empty = 0,
  Steel = 1,
  Rust = 2,
  Hazard = 3,
  Catwalk = 4,
  Electric = 5,
  Crate = 6,
  Gate = 7,
}

export type EnemyKind = 'drone' | 'trooper' | 'turret';
export type TurretMount = 'floor' | 'ceiling' | 'wall-left' | 'wall-right';

export interface EnemySpawn {
  kind: EnemyKind;
  x: number;
  y: number;
  mount?: TurretMount;
  section: number;
}

export interface PickupSpawn {
  kind: PickupKind;
  x: number;
  y: number;
}

export interface Body {
  x: number;
  y: number;
  w: number;
  h: number;
  vx: number;
  vy: number;
}

export interface CollisionResult {
  ground: boolean;
  ceiling: boolean;
  wall: number;
  groundTile: Tile;
}

export const LEVEL_WIDTH = 168;
export const LEVEL_HEIGHT = 18;

export class Level {
  readonly width = LEVEL_WIDTH;
  readonly height = LEVEL_HEIGHT;
  readonly grid = new Uint8Array(LEVEL_WIDTH * LEVEL_HEIGHT);
  readonly enemies: EnemySpawn[] = [];
  readonly pickups: PickupSpawn[] = [];
  readonly checkpoints: number[] = [];
  readonly playerStart = { x: 5, y: 2 };
  readonly gateX = 133;
  readonly arenaTriggerX = 138;
  readonly arenaMinX = 134;
  readonly arenaMaxX = 166;
  readonly bossSpawn = { x: 155, y: 2 };
  readonly sections = [
    { name: 'HANGAR BAY', start: 0 },
    { name: 'FOUNDRY', start: 43 },
    { name: 'REACTOR SHAFT', start: 89 },
    { name: 'GUARDIAN CORE', start: 133 },
  ];
  gateClosed = false;

  constructor() {
    this.build();
  }

  get(tx: number, ty: number): Tile {
    if (tx < 0 || tx >= this.width) return Tile.Steel;
    if (ty < 0) return Tile.Steel;
    if (ty >= this.height) return Tile.Steel;
    return this.grid[ty * this.width + tx] as Tile;
  }

  isSolid(tile: Tile): boolean {
    if (tile === Tile.Empty || tile === Tile.Catwalk) return false;
    if (tile === Tile.Gate) return this.gateClosed;
    return true;
  }

  solidAt(x: number, y: number): boolean {
    return this.isSolid(this.get(Math.floor(x), Math.floor(y)));
  }

  groundBelow(x: number, y: number): number {
    const tx = Math.floor(x);
    for (let ty = Math.floor(y); ty >= 0; ty -= 1) {
      const tile = this.get(tx, ty);
      if (this.isSolid(tile) || tile === Tile.Catwalk) return ty + 1;
    }
    return 0;
  }

  sectionIndexAt(x: number): number {
    let index = 0;
    for (let i = 0; i < this.sections.length; i += 1) if (x >= this.sections[i].start) index = i;
    return index;
  }

  move(body: Body, dt: number, dropThrough: boolean, out: CollisionResult): CollisionResult {
    out.ground = false;
    out.ceiling = false;
    out.wall = 0;
    out.groundTile = Tile.Empty;
    const half = body.w / 2;
    const eps = 0.001;

    let nx = body.x + body.vx * dt;
    const y0 = Math.floor(body.y + eps);
    const y1 = Math.floor(body.y + body.h - eps);
    if (body.vx > 0) {
      const tx = Math.floor(nx + half);
      for (let ty = y0; ty <= y1; ty += 1) {
        if (this.isSolid(this.get(tx, ty))) {
          nx = tx - half - eps;
          body.vx = 0;
          out.wall = 1;
          break;
        }
      }
    } else if (body.vx < 0) {
      const tx = Math.floor(nx - half);
      for (let ty = y0; ty <= y1; ty += 1) {
        if (this.isSolid(this.get(tx, ty))) {
          nx = tx + 1 + half + eps;
          body.vx = 0;
          out.wall = -1;
          break;
        }
      }
    }
    body.x = nx;

    let ny = body.y + body.vy * dt;
    const x0 = Math.floor(body.x - half + eps);
    const x1 = Math.floor(body.x + half - eps);
    if (body.vy <= 0) {
      const ty = Math.floor(ny);
      for (let tx = x0; tx <= x1; tx += 1) {
        const tile = this.get(tx, ty);
        const oneWay = tile === Tile.Catwalk && !dropThrough && body.y >= ty + 1 - 0.05;
        if (this.isSolid(tile) || oneWay) {
          ny = ty + 1;
          body.vy = 0;
          out.ground = true;
          if (out.groundTile === Tile.Empty || tile === Tile.Electric) out.groundTile = tile;
        }
      }
    } else {
      const ty = Math.floor(ny + body.h);
      for (let tx = x0; tx <= x1; tx += 1) {
        if (this.isSolid(this.get(tx, ty))) {
          ny = ty - body.h - eps;
          body.vy = 0;
          out.ceiling = true;
          break;
        }
      }
    }
    body.y = ny;
    return out;
  }

  private set(x: number, y: number, tile: Tile): void {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return;
    this.grid[y * this.width + x] = tile;
  }

  private fill(x0: number, x1: number, y0: number, y1: number, tile: Tile): void {
    for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) this.set(x, y, tile);
  }

  private build(): void {
    const W = this.width;
    this.fill(0, W - 1, 0, 1, Tile.Steel);
    this.fill(0, W - 1, 16, 17, Tile.Steel);
    this.fill(0, 1, 0, 17, Tile.Steel);
    this.fill(W - 2, W - 1, 0, 17, Tile.Steel);

    // A — Hangar bay: teach move, shoot, jump, jet.
    this.fill(12, 18, 5, 5, Tile.Catwalk);
    this.fill(26, 27, 2, 2, Tile.Crate);
    this.set(27, 3, Tile.Crate);
    this.fill(30, 40, 13, 15, Tile.Rust);
    this.fill(34, 42, 2, 2, Tile.Hazard);
    this.fill(2, 8, 15, 15, Tile.Rust);
    this.enemies.push({ kind: 'drone', x: 23, y: 7, section: 0 });
    this.enemies.push({ kind: 'drone', x: 38, y: 8, section: 0 });
    this.pickups.push({ kind: 'repair', x: 15.5, y: 6.6 });

    // B — Foundry: electrified pit, troopers, jet-gated upgrade.
    this.fill(46, 56, 1, 1, Tile.Empty);
    this.fill(46, 56, 0, 0, Tile.Electric);
    this.fill(48, 50, 5, 5, Tile.Catwalk);
    this.fill(53, 55, 5, 5, Tile.Catwalk);
    this.fill(58, 88, 14, 15, Tile.Steel);
    this.fill(64, 68, 8, 8, Tile.Catwalk);
    this.fill(71, 72, 2, 3, Tile.Rust);
    this.fill(80, 88, 1, 1, Tile.Hazard);
    this.fill(82, 84, 2, 2, Tile.Crate);
    this.checkpoints.push(59);
    this.enemies.push({ kind: 'trooper', x: 63, y: 2, section: 1 });
    this.enemies.push({ kind: 'drone', x: 52, y: 9, section: 1 });
    this.enemies.push({ kind: 'trooper', x: 77, y: 2, section: 1 });
    this.pickups.push({ kind: 'spread', x: 66.5, y: 9.6 });
    this.pickups.push({ kind: 'repair', x: 86, y: 3.6 });

    // C — Reactor shaft: stepped climb, turrets, drone pair.
    this.fill(92, 97, 2, 4, Tile.Steel);
    this.fill(92, 97, 4, 4, Tile.Hazard);
    this.fill(101, 106, 2, 7, Tile.Rust);
    this.fill(108, 112, 9, 9, Tile.Catwalk);
    this.fill(114, 118, 5, 5, Tile.Catwalk);
    this.fill(119, 124, 13, 15, Tile.Rust);
    this.checkpoints.push(128);
    this.enemies.push({ kind: 'turret', x: 104.5, y: 8, mount: 'floor', section: 2 });
    this.enemies.push({ kind: 'drone', x: 99, y: 11, section: 2 });
    this.enemies.push({ kind: 'turret', x: 116.5, y: 16, mount: 'ceiling', section: 2 });
    this.enemies.push({ kind: 'drone', x: 121, y: 9, section: 2 });
    this.enemies.push({ kind: 'turret', x: 125.5, y: 2, mount: 'floor', section: 2 });
    this.pickups.push({ kind: 'repair', x: 110.5, y: 10.6 });
    this.pickups.push({ kind: 'life', x: 94.5, y: 6.2 });

    // D — Guardian arena.
    this.fill(this.gateX, this.gateX, 2, 15, Tile.Gate);
    this.fill(138, 141, 6, 6, Tile.Catwalk);
    this.fill(158, 161, 6, 6, Tile.Catwalk);
    this.fill(134, W - 3, 1, 1, Tile.Hazard);
    this.pickups.push({ kind: 'repair', x: 159.5, y: 7.6 });
  }
}
