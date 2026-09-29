import * as THREE from 'three';
import { createPose, MechModel } from '../graphics/MechModel';
import { PALETTE } from '../graphics/materials';
import { DroneModel, TurretModel } from '../graphics/Props';
import { Tile, type Body, type CollisionResult, type EnemyKind, type TurretMount } from '../levels/Level';
import type { GameContext } from '../game/types';
import type { Projectile } from './Projectiles';

export abstract class Enemy {
  abstract readonly kind: EnemyKind | 'boss';
  readonly group = new THREE.Group();
  hp: number;
  alive = true;
  awake = false;
  facing = -1;
  protected hurt = 0;
  protected telegraph = 0;

  constructor(
    public x: number,
    public y: number,
    public w: number,
    public h: number,
    readonly maxHp: number,
    readonly score: number,
    readonly contactDamage: number,
  ) {
    this.hp = maxHp;
  }

  get cx(): number {
    return this.x;
  }

  get cy(): number {
    return this.y + this.h / 2;
  }

  overlaps(x: number, y: number, r: number): boolean {
    return x + r > this.x - this.w / 2 && x - r < this.x + this.w / 2 && y + r > this.y && y - r < this.y + this.h;
  }

  overlapsBox(x0: number, y0: number, x1: number, y1: number): boolean {
    return x1 > this.x - this.w / 2 && x0 < this.x + this.w / 2 && y1 > this.y && y0 < this.y + this.h;
  }

  /** Return true when the projectile was blocked rather than dealing damage. */
  blocks(_p: Projectile): boolean {
    return false;
  }

  damage(amount: number, ctx: GameContext, fromSaber = false): boolean {
    if (!this.alive) return false;
    this.hp -= amount;
    this.hurt = 1;
    this.onDamaged(amount, ctx, fromSaber);
    if (this.hp <= 0) {
      this.alive = false;
      this.onDeath(ctx);
      return true;
    }
    ctx.audio.hit();
    return false;
  }

  protected onDamaged(_amount: number, _ctx: GameContext, _fromSaber: boolean): void {}

  protected onDeath(ctx: GameContext): void {
    ctx.vfx.explosion(this.cx, this.cy, this.kind === 'trooper' ? 1.3 : 1);
    ctx.audio.explosion(this.kind === 'trooper' ? 1.3 : 1);
    ctx.shake(0.3);
    ctx.hitstop(40);
    ctx.addScore(this.score, this.cx, this.cy + this.h / 2);
    ctx.enemyKilled();
    this.group.visible = false;
  }

  abstract update(dt: number, ctx: GameContext): void;
  abstract sync(dt: number, time: number): void;
  dispose(): void {}
}

export class Drone extends Enemy {
  readonly kind = 'drone' as const;
  readonly model = new DroneModel();
  private vx = 0;
  private vy = 0;
  private fireTimer: number;
  private readonly homeY: number;
  private phase: number;

  constructor(x: number, y: number, rng: () => number) {
    super(x, y, 0.9, 0.8, 3, 100, 1);
    this.homeY = y;
    this.fireTimer = 1.2 + rng() * 1.2;
    this.phase = rng() * 6;
    this.group.add(this.model.group);
  }

  update(dt: number, ctx: GameContext): void {
    const p = ctx.player;
    this.hurt = Math.max(0, this.hurt - dt * 6);
    this.phase += dt;
    const dx = p.x - this.x;
    const engaged = Math.abs(dx) < 14 && p.alive;
    let tx = this.x;
    let ty = this.homeY + Math.sin(this.phase * 1.6) * 0.8;
    if (engaged) {
      tx = p.x - Math.sign(dx || 1) * 5.5;
      ty = Math.min(13.5, Math.max(p.centerY + 2.8, 4)) + Math.sin(this.phase * 2.2) * 0.7;
      this.facing = dx >= 0 ? 1 : -1;
    }
    const ax = THREE.MathUtils.clamp((tx - this.x) * 3 - this.vx * 2.2, -14, 14);
    const ay = THREE.MathUtils.clamp((ty - this.cy) * 3 - this.vy * 2.2, -14, 14);
    this.vx = THREE.MathUtils.clamp(this.vx + ax * dt, -4.5, 4.5);
    this.vy = THREE.MathUtils.clamp(this.vy + ay * dt, -4, 4);
    const nx = this.x + this.vx * dt;
    const ny = this.y + this.vy * dt;
    if (!ctx.level.solidAt(nx + Math.sign(this.vx) * 0.5, this.cy)) this.x = nx;
    else this.vx *= -0.5;
    if (!ctx.level.solidAt(this.x, ny + (this.vy > 0 ? this.h + 0.1 : -0.1))) this.y = ny;
    else this.vy *= -0.5;

    if (engaged) {
      this.fireTimer -= dt;
      this.telegraph = this.fireTimer < 0.55 ? 1 - this.fireTimer / 0.55 : 0;
      if (this.fireTimer <= 0.55 && this.fireTimer + dt > 0.55) ctx.audio.telegraph();
      if (this.fireTimer <= 0) {
        this.fireTimer = 2.3 + ctx.rng() * 0.9;
        this.telegraph = 0;
        const ang = Math.atan2(p.centerY - this.cy, p.x - this.x);
        const speed = 7.5;
        ctx.projectiles.spawn('enemy', 'orb', this.x + Math.cos(ang) * 0.5, this.cy + Math.sin(ang) * 0.5, Math.cos(ang) * speed, Math.sin(ang) * speed, 1, 3);
        ctx.audio.enemyShot();
        ctx.vfx.muzzle(this.x + Math.cos(ang) * 0.5, this.cy, Math.cos(ang), Math.sin(ang), PALETTE.plasmaEnemy);
      }
    } else {
      this.telegraph = 0;
    }
  }

  sync(_dt: number, time: number): void {
    this.group.position.set(this.x, this.cy, 0);
    this.group.rotation.z = THREE.MathUtils.clamp(-this.vx * 0.06 * this.facing, -0.3, 0.3);
    this.model.update(time + this.phase, this.telegraph, this.hurt, this.facing);
  }

  dispose(): void {
    this.model.dispose();
  }
}

export class Trooper extends Enemy {
  readonly kind = 'trooper' as const;
  readonly model = new MechModel('trooper');
  private readonly body: Body;
  private readonly col: CollisionResult = { ground: false, ceiling: false, wall: 0, groundTile: Tile.Empty };
  private readonly pose = createPose();
  private state: 'patrol' | 'aim' | 'burst' | 'cooldown' | 'guard' | 'stun' = 'patrol';
  private timer = 0;
  private shots = 0;
  private recentHits = 0;
  private guardTimer = 0;
  private recoil = 0;
  private aimAngle = 0;
  private readonly laser: THREE.Mesh;
  private readonly muzzle = new THREE.Vector3();
  private readonly home: number;

  constructor(x: number, y: number, rng: () => number) {
    super(x, y, 1.1, 2.2, 10, 300, 2);
    this.body = { x, y, w: 1.1, h: 2.2, vx: 0, vy: 0 };
    this.home = x;
    this.timer = rng() * 1.5;
    this.group.add(this.model.group);
    this.laser = new THREE.Mesh(
      new THREE.BoxGeometry(1, 0.05, 0.05),
      new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff2d6a').multiplyScalar(2.5), transparent: true, opacity: 0.8, depthWrite: false }),
    );
    this.laser.geometry.translate(0.5, 0, 0);
    this.laser.visible = false;
  }

  get laserMesh(): THREE.Mesh {
    return this.laser;
  }

  blocks(p: Projectile): boolean {
    if (this.state !== 'guard') return false;
    return Math.sign(p.vx) === -this.facing;
  }

  protected onDamaged(_amount: number, ctx: GameContext, fromSaber: boolean): void {
    if (fromSaber && this.state === 'guard') {
      this.state = 'stun';
      this.timer = 0.9;
      ctx.vfx.sparks(this.cx, this.cy, '#ff7ad1', 14, 9);
      return;
    }
    this.recentHits += 1;
    if (this.recentHits >= 3 && this.state !== 'stun' && this.state !== 'guard') {
      this.state = 'guard';
      this.timer = 1.3;
      this.recentHits = 0;
      ctx.audio.shieldBlock();
    }
  }

  update(dt: number, ctx: GameContext): void {
    const p = ctx.player;
    this.hurt = Math.max(0, this.hurt - dt * 6);
    this.recoil = Math.max(0, this.recoil - dt * 10);
    this.recentHits = Math.max(0, this.recentHits - dt * 1.2);
    this.guardTimer = Math.max(0, this.guardTimer - dt);
    const dx = p.x - this.body.x;
    const dy = p.centerY - (this.body.y + 1.2);
    const inRange = Math.abs(dx) < 12 && Math.abs(dy) < 5 && p.alive;
    let move = 0;
    this.timer -= dt;
    this.telegraph = 0;

    switch (this.state) {
      case 'patrol':
        if (inRange) {
          this.facing = dx >= 0 ? 1 : -1;
          const dist = Math.abs(dx);
          if (dist > 7.5) move = this.facing;
          else if (dist < 3.5) move = -this.facing;
          if (this.timer <= 0) {
            this.state = 'aim';
            this.timer = 0.65;
            ctx.audio.telegraph();
          }
        } else {
          const toHome = this.home - this.body.x;
          move = Math.abs(toHome) > 0.5 ? Math.sign(toHome) * 0.5 : 0;
          if (move !== 0) this.facing = move > 0 ? 1 : -1;
        }
        break;
      case 'aim':
        this.facing = dx >= 0 ? 1 : -1;
        this.aimAngle = THREE.MathUtils.clamp(Math.atan2(dy, Math.abs(dx)), -0.45, 0.45);
        this.telegraph = 1 - this.timer / 0.65;
        if (this.timer <= 0) {
          this.state = 'burst';
          this.shots = 3;
          this.timer = 0;
        }
        break;
      case 'burst':
        if (this.timer <= 0 && this.shots > 0) {
          this.fire(ctx);
          this.shots -= 1;
          this.timer = 0.13;
        }
        if (this.shots <= 0 && this.timer <= 0) {
          this.state = 'cooldown';
          this.timer = 1.5 + ctx.rng() * 0.6;
        }
        break;
      case 'cooldown':
        if (inRange) {
          this.facing = dx >= 0 ? 1 : -1;
          if (Math.abs(dx) < 3) move = -this.facing;
        }
        if (this.timer <= 0) {
          this.state = 'patrol';
          this.timer = 0.4;
        }
        break;
      case 'guard':
        this.facing = dx >= 0 ? 1 : -1;
        if (this.timer <= 0) {
          this.state = 'cooldown';
          this.timer = 0.3;
        }
        break;
      case 'stun':
        if (this.timer <= 0) {
          this.state = 'cooldown';
          this.timer = 0.5;
        }
        break;
    }

    const speed = 2.6;
    this.body.vx += (move * speed - this.body.vx) * Math.min(1, dt * 10);
    this.body.vy = Math.max(-24, this.body.vy - 40 * dt);
    ctx.level.move(this.body, dt, false, this.col);
    if (this.col.wall !== 0 && this.col.ground && move !== 0) this.body.vy = 11;
    if (this.col.ground && this.col.groundTile === Tile.Electric) this.body.vy = 10;
    this.x = this.body.x;
    this.y = this.body.y;
  }

  private fire(ctx: GameContext): void {
    this.model.group.updateMatrixWorld(true);
    this.model.muzzle.getWorldPosition(this.muzzle);
    const speed = 13;
    const vx = Math.cos(this.aimAngle) * this.facing * speed;
    const vy = Math.sin(this.aimAngle) * speed;
    ctx.projectiles.spawn('enemy', 'orb', this.muzzle.x, this.muzzle.y, vx, vy, 1, 2);
    ctx.vfx.muzzle(this.muzzle.x, this.muzzle.y, this.facing, 0, PALETTE.plasmaEnemy);
    ctx.audio.enemyShot();
    this.recoil = 1;
  }

  sync(dt: number, time: number): void {
    const pose = this.pose;
    const speed = Math.abs(this.body.vx);
    pose.walkAmount += (Math.min(1, speed / 2.6) - pose.walkAmount) * Math.min(1, dt * 10);
    pose.walkPhase += speed * dt * 1.6;
    pose.airborne = !this.col.ground;
    pose.aim = this.state === 'aim' || this.state === 'burst' ? this.aimAngle / (Math.PI / 4) : 0;
    pose.recoil = this.recoil;
    pose.shield += ((this.state === 'guard' ? 1 : 0) - pose.shield) * Math.min(1, dt * 18);
    pose.crouch = this.state === 'stun' ? 0.6 : this.state === 'aim' ? 0.2 : 0;
    pose.telegraph = this.telegraph;
    pose.hurt = this.hurt;
    this.model.setFacing(this.facing);
    this.model.group.position.set(this.body.x, this.body.y, 0);
    this.model.update(pose, dt, time);

    this.laser.visible = this.state === 'aim' && this.alive;
    if (this.laser.visible) {
      this.model.group.updateMatrixWorld(true);
      this.model.muzzle.getWorldPosition(this.muzzle);
      this.laser.position.set(this.muzzle.x, this.muzzle.y, 0.3);
      this.laser.rotation.z = this.facing > 0 ? this.aimAngle : Math.PI - this.aimAngle;
      this.laser.scale.x = 12;
      (this.laser.material as THREE.MeshBasicMaterial).opacity = 0.35 + this.telegraph * 0.6 * (Math.floor(time * 20) % 2 ? 1 : 0.6);
    }
  }

  protected onDeath(ctx: GameContext): void {
    super.onDeath(ctx);
    this.laser.visible = false;
  }

  dispose(): void {
    this.model.dispose();
  }
}

export class Turret extends Enemy {
  readonly kind = 'turret' as const;
  readonly model: TurretModel;
  private fireTimer: number;
  private angle: number;
  private readonly baseAngle: number;
  private readonly muzzle = new THREE.Vector3();

  constructor(x: number, y: number, readonly mount: TurretMount, rng: () => number) {
    super(x, mount === 'ceiling' ? y - 1 : y, 1.0, 1.0, 6, 200, 1);
    this.model = new TurretModel(mount);
    this.baseAngle = mount === 'ceiling' ? -Math.PI / 2 : mount === 'wall-left' ? 0 : mount === 'wall-right' ? Math.PI : Math.PI / 2;
    this.angle = this.baseAngle;
    this.fireTimer = 1 + rng();
    this.group.add(this.model.group);
    this.group.position.set(x, y, -0.3);
  }

  update(dt: number, ctx: GameContext): void {
    const p = ctx.player;
    this.hurt = Math.max(0, this.hurt - dt * 6);
    const dx = p.x - this.x;
    const dy = p.centerY - this.cy;
    const engaged = Math.hypot(dx, dy) < 15 && p.alive;
    if (!engaged) {
      this.telegraph = 0;
      return;
    }
    let target = Math.atan2(dy, dx);
    let rel = Math.atan2(Math.sin(target - this.baseAngle), Math.cos(target - this.baseAngle));
    rel = THREE.MathUtils.clamp(rel, -1.35, 1.35);
    target = this.baseAngle + rel;
    const diff = Math.atan2(Math.sin(target - this.angle), Math.cos(target - this.angle));
    this.angle += THREE.MathUtils.clamp(diff, -2.5 * dt, 2.5 * dt);
    this.fireTimer -= dt;
    this.telegraph = this.fireTimer < 0.5 ? 1 - this.fireTimer / 0.5 : 0;
    if (this.fireTimer <= 0.5 && this.fireTimer + dt > 0.5) ctx.audio.telegraph();
    if (this.fireTimer <= 0) {
      this.fireTimer = 1.7 + ctx.rng() * 0.5;
      this.model.group.updateMatrixWorld(true);
      this.model.muzzle.getWorldPosition(this.muzzle);
      const speed = 10;
      ctx.projectiles.spawn('enemy', 'orb', this.muzzle.x, this.muzzle.y, Math.cos(this.angle) * speed, Math.sin(this.angle) * speed, 2, 2.5);
      ctx.vfx.muzzle(this.muzzle.x, this.muzzle.y, Math.cos(this.angle), Math.sin(this.angle), PALETTE.plasmaGreen);
      ctx.audio.enemyShot();
    }
  }

  sync(): void {
    this.model.aimAt(this.angle);
    this.model.update(this.telegraph, this.hurt);
  }
}
