import * as THREE from 'three';
import { PALETTE } from '../graphics/materials';
import type { Level } from '../levels/Level';
import type { Vfx } from '../graphics/Vfx';

export type ProjectileOwner = 'player' | 'enemy';
export type ProjectileKind = 'bolt' | 'orb' | 'cannon';

export interface Projectile {
  active: boolean;
  owner: ProjectileOwner;
  kind: ProjectileKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  damage: number;
  radius: number;
  reflected: boolean;
}

const MAX = 160;

export class Projectiles {
  readonly group = new THREE.Group();
  readonly list: Projectile[] = [];
  private readonly bolts: THREE.InstancedMesh;
  private readonly orbs: THREE.InstancedMesh;
  private readonly orbCores: THREE.InstancedMesh;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3();
  private readonly p = new THREE.Vector3();
  private readonly axis = new THREE.Vector3(0, 0, 1);
  private readonly c = new THREE.Color();

  constructor() {
    for (let i = 0; i < MAX; i += 1) {
      this.list.push({ active: false, owner: 'player', kind: 'bolt', x: 0, y: 0, vx: 0, vy: 0, life: 0, damage: 1, radius: 0.2, reflected: false });
    }
    this.bolts = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.9, 0.16, 0.16),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.plasmaPlayer).multiplyScalar(2.6) }),
      MAX,
    );
    this.orbs = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.3, 8, 6),
      new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending }),
      MAX,
    );
    this.orbCores = new THREE.InstancedMesh(new THREE.SphereGeometry(0.16, 6, 4), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffffff').multiplyScalar(2.8) }), MAX);
    for (const mesh of [this.bolts, this.orbs, this.orbCores]) {
      mesh.frustumCulled = false;
      mesh.count = 0;
      this.group.add(mesh);
    }
    this.orbs.setColorAt(0, this.c.set('#ffffff'));
  }

  spawn(owner: ProjectileOwner, kind: ProjectileKind, x: number, y: number, vx: number, vy: number, damage: number, life = 1.6): Projectile | null {
    const slot = this.list.find((p) => !p.active);
    if (!slot) return null;
    slot.active = true;
    slot.owner = owner;
    slot.kind = kind;
    slot.x = x;
    slot.y = y;
    slot.vx = vx;
    slot.vy = vy;
    slot.damage = damage;
    slot.life = life;
    slot.radius = kind === 'bolt' ? 0.22 : kind === 'cannon' ? 0.42 : 0.3;
    slot.reflected = false;
    return slot;
  }

  reflect(p: Projectile, facing: number): void {
    p.owner = 'player';
    p.kind = 'bolt';
    const speed = Math.max(18, Math.hypot(p.vx, p.vy) * 1.6);
    p.vx = facing * speed;
    p.vy = 0;
    p.damage = Math.max(2, p.damage * 2);
    p.life = 1.2;
    p.reflected = true;
  }

  update(dt: number, level: Level, vfx: Vfx, time: number): void {
    for (const p of this.list) {
      if (!p.active) continue;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        continue;
      }
      if (level.solidAt(p.x, p.y)) {
        p.active = false;
        vfx.sparks(p.x - Math.sign(p.vx) * 0.2, p.y, p.owner === 'player' ? PALETTE.plasmaPlayer : PALETTE.plasmaEnemy, 5, 5);
      }
    }
    this.syncMeshes(time);
  }

  clear(): void {
    for (const p of this.list) p.active = false;
    this.syncMeshes(0);
  }

  private syncMeshes(time: number): void {
    let nb = 0;
    let no = 0;
    for (const p of this.list) {
      if (!p.active) continue;
      if (p.owner === 'player') {
        this.q.setFromAxisAngle(this.axis, Math.atan2(p.vy, p.vx));
        this.s.set(p.reflected ? 1.3 : 1, p.reflected ? 1.6 : 1, 1);
        this.p.set(p.x, p.y, 0.5);
        this.m.compose(this.p, this.q, this.s);
        this.bolts.setMatrixAt(nb, this.m);
        nb += 1;
      } else {
        const pulse = 1 + Math.sin(time * 30 + p.x) * 0.15;
        const scale = (p.kind === 'cannon' ? 1.5 : 1) * pulse;
        this.q.identity();
        this.s.setScalar(scale);
        this.p.set(p.x, p.y, 0.5);
        this.m.compose(this.p, this.q, this.s);
        this.orbs.setMatrixAt(no, this.m);
        this.c.set(p.kind === 'cannon' ? '#ff5a3c' : p.kind === 'orb' && p.damage > 1 ? PALETTE.plasmaGreen : PALETTE.plasmaEnemy).multiplyScalar(2.2);
        this.orbs.setColorAt(no, this.c);
        this.orbCores.setMatrixAt(no, this.m);
        no += 1;
      }
    }
    this.bolts.count = nb;
    this.orbs.count = no;
    this.orbCores.count = no;
    this.bolts.instanceMatrix.needsUpdate = true;
    this.orbs.instanceMatrix.needsUpdate = true;
    this.orbCores.instanceMatrix.needsUpdate = true;
    if (this.orbs.instanceColor) this.orbs.instanceColor.needsUpdate = true;
  }
}
