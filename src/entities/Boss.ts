import * as THREE from 'three';
import { createPose, MechModel } from '../graphics/MechModel';
import { Tile, type Body, type CollisionResult } from '../levels/Level';
import type { GameContext } from '../game/types';
import { Enemy } from './Enemies';

type BossState = 'intro' | 'idle' | 'walk' | 'volleyTell' | 'volley' | 'stompTell' | 'stomp' | 'dashTell' | 'dash' | 'stunned' | 'summon' | 'dying';

interface Wave {
  active: boolean;
  x: number;
  y: number;
  dir: number;
  life: number;
  mesh: THREE.Mesh;
}

export class Boss extends Enemy {
  readonly kind = 'boss' as const;
  readonly model = new MechModel('havoc');
  readonly waves: Wave[] = [];
  private readonly body: Body;
  private readonly col: CollisionResult = { ground: false, ceiling: false, wall: 0, groundTile: Tile.Empty };
  private readonly pose = createPose();
  state: BossState = 'intro';
  private timer = 0;
  private shots = 0;
  private dashDir = 1;
  private summoned = 0;
  private sinceSummon = 0;
  private attackIndex = 0;
  private deathTimer = 0;
  private recoil = 0;
  finished = false;

  constructor(x: number, y: number) {
    super(x, y, 2.3, 3.8, 90, 5000, 3);
    this.body = { x, y: y + 6, w: 2.3, h: 3.8, vx: 0, vy: 0 };
    this.group.add(this.model.group);
    const waveMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff7a3a').multiplyScalar(2.4), transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending });
    const waveGeo = new THREE.ConeGeometry(0.45, 1.3, 4);
    waveGeo.translate(0, 0.65, 0);
    for (let i = 0; i < 4; i += 1) {
      const mesh = new THREE.Mesh(waveGeo, waveMat);
      mesh.visible = false;
      this.waves.push({ active: false, x: 0, y: 0, dir: 1, life: 0, mesh });
    }
  }

  get phase(): number {
    const r = this.hp / this.maxHp;
    return r > 0.6 ? 1 : r > 0.3 ? 2 : 3;
  }

  begin(ctx: GameContext): void {
    this.state = 'intro';
    this.timer = 1.6;
    this.awake = true;
    ctx.audio.alarm();
  }

  protected onDeath(ctx: GameContext): void {
    this.alive = true;
    this.hp = 0;
    this.state = 'dying';
    this.deathTimer = 2.4;
    ctx.addScore(this.score, this.cx, this.cy + 2);
    ctx.hitstop(120);
    ctx.shake(0.9);
    ctx.flash('#ffffff', 0.6);
    ctx.audio.explosion(2.5);
  }

  damage(amount: number, ctx: GameContext, fromSaber = false): boolean {
    if (this.state === 'intro' || this.state === 'dying') return false;
    const bonus = this.state === 'stunned' ? 2 : 1;
    return super.damage(amount * bonus, ctx, fromSaber);
  }

  update(dt: number, ctx: GameContext): void {
    const p = ctx.player;
    this.hurt = Math.max(0, this.hurt - dt * 10);
    this.recoil = Math.max(0, this.recoil - dt * 8);
    this.timer -= dt;
    this.sinceSummon += dt;
    this.telegraph = 0;
    const dx = p.x - this.body.x;
    let move = 0;

    if (this.state === 'dying') {
      this.deathTimer -= dt;
      if (ctx.rng() < dt * 14) {
        const ex = this.body.x + (ctx.rng() - 0.5) * 3;
        const ey = this.body.y + ctx.rng() * 3.5;
        ctx.vfx.explosion(ex, ey, 0.8 + ctx.rng() * 0.6);
        ctx.audio.explosion(1);
        ctx.shake(0.25);
      }
      this.hurt = Math.floor(this.deathTimer * 12) % 2 ? 1 : 0.2;
      if (this.deathTimer <= 0 && !this.finished) {
        this.finished = true;
        this.alive = false;
        ctx.vfx.explosion(this.cx, this.cy, 3);
        ctx.shake(1);
        ctx.flash('#ffffff', 0.8);
        ctx.enemyKilled();
        this.group.visible = false;
      }
      this.physics(dt, ctx, 0);
      return;
    }

    switch (this.state) {
      case 'intro':
        if (this.timer <= 0 && this.col.ground) this.next(ctx);
        break;
      case 'idle':
        this.facing = dx >= 0 ? 1 : -1;
        if (this.timer <= 0) this.next(ctx);
        break;
      case 'walk':
        this.facing = dx >= 0 ? 1 : -1;
        move = Math.abs(dx) > 4 ? this.facing : 0;
        if (this.timer <= 0 || Math.abs(dx) < 3.5) this.next(ctx);
        break;
      case 'volleyTell':
        this.facing = dx >= 0 ? 1 : -1;
        this.telegraph = 1 - this.timer / 0.75;
        if (this.timer <= 0) {
          this.state = 'volley';
          this.shots = this.phase === 1 ? 2 : 3;
          this.timer = 0;
        }
        break;
      case 'volley':
        if (this.timer <= 0 && this.shots > 0) {
          this.fireVolley(ctx);
          this.shots -= 1;
          this.timer = 0.38;
        }
        if (this.shots <= 0 && this.timer <= 0) {
          this.state = 'idle';
          this.timer = 0.7;
        }
        break;
      case 'stompTell':
        this.telegraph = 1 - this.timer / 0.6;
        if (this.timer <= 0) {
          this.state = 'stomp';
          this.timer = 0.5;
          this.spawnWaves(ctx);
        }
        break;
      case 'stomp':
        if (this.timer <= 0) {
          this.state = 'idle';
          this.timer = 0.6;
        }
        break;
      case 'dashTell':
        this.telegraph = 1 - this.timer / 0.85;
        if (ctx.rng() < 0.6) ctx.vfx.jetTrail(this.body.x - this.facing * 1.2, this.body.y + 2.2);
        if (this.timer <= 0) {
          this.state = 'dash';
          this.dashDir = this.facing;
          this.timer = 2.2;
        }
        break;
      case 'dash':
        move = this.dashDir * 5.5;
        if (ctx.rng() < 0.8) ctx.vfx.jetTrail(this.body.x - this.dashDir * 1.2, this.body.y + 2.0);
        if (this.col.wall !== 0 || this.timer <= 0) {
          this.state = 'stunned';
          this.timer = 1.5;
          ctx.shake(0.7);
          ctx.audio.stomp();
          ctx.vfx.explosion(this.body.x + this.dashDir * 1.2, this.body.y + 1.5, 0.8);
        }
        break;
      case 'stunned':
        if (ctx.rng() < dt * 10) ctx.vfx.sparks(this.body.x, this.body.y + 3, '#ffe066', 4, 4);
        if (this.timer <= 0) {
          this.state = 'idle';
          this.timer = 0.5;
        }
        break;
      case 'summon':
        this.telegraph = 0.6;
        if (this.timer <= 0) {
          ctx.spawnDrone(this.body.x - 4, 11);
          ctx.spawnDrone(this.body.x + 4, 12);
          this.summoned += 1;
          this.sinceSummon = 0;
          this.state = 'idle';
          this.timer = 1;
        }
        break;
    }

    this.physics(dt, ctx, move);
    this.updateWaves(dt, ctx);
  }

  private next(ctx: GameContext): void {
    const p = ctx.player;
    const dist = Math.abs(p.x - this.body.x);
    this.facing = p.x >= this.body.x ? 1 : -1;
    if (this.phase === 3 && (this.summoned === 0 || this.sinceSummon > 13)) {
      this.state = 'summon';
      this.timer = 0.9;
      ctx.audio.alarm();
      return;
    }
    if (dist < 4.5 && p.grounded) {
      this.state = 'stompTell';
      this.timer = 0.6;
      ctx.audio.telegraph();
      return;
    }
    const pattern = this.phase === 1 ? ['walk', 'volley', 'walk', 'volley'] : ['volley', 'dash', 'walk', 'volley', 'dash'];
    const pick = pattern[this.attackIndex % pattern.length];
    this.attackIndex += 1;
    if (pick === 'walk') {
      this.state = 'walk';
      this.timer = 1.4;
    } else if (pick === 'volley') {
      this.state = 'volleyTell';
      this.timer = 0.75;
      ctx.audio.telegraph();
    } else {
      this.state = 'dashTell';
      this.timer = 0.85;
      ctx.audio.alarm();
    }
  }

  private physics(dt: number, ctx: GameContext, move: number): void {
    const speed = 2.2;
    const target = move * speed;
    this.body.vx += (target - this.body.vx) * Math.min(1, dt * (this.state === 'dash' ? 6 : 8));
    this.body.vy = Math.max(-26, this.body.vy - 40 * dt);
    const wasGround = this.col.ground;
    const prevVy = this.body.vy;
    ctx.level.move(this.body, dt, false, this.col);
    if (!wasGround && this.col.ground && prevVy < -8) {
      ctx.shake(0.8);
      ctx.audio.stomp();
      ctx.vfx.dust(this.body.x, this.body.y, 16);
    }
    this.body.x = THREE.MathUtils.clamp(this.body.x, ctx.level.arenaMinX + 1.5, ctx.level.arenaMaxX - 1.5);
    this.x = this.body.x;
    this.y = this.body.y;
  }

  private fireVolley(ctx: GameContext): void {
    const p = ctx.player;
    const ox = this.body.x + this.facing * 1.4;
    const oy = this.body.y + 3.4;
    const base = Math.atan2(p.centerY - oy, p.x - ox);
    const count = this.phase === 1 ? 3 : 5;
    for (let i = 0; i < count; i += 1) {
      const a = base + (i - (count - 1) / 2) * 0.22;
      ctx.projectiles.spawn('enemy', 'cannon', ox, oy, Math.cos(a) * 8.5, Math.sin(a) * 8.5, 2, 3);
    }
    ctx.vfx.muzzle(ox, oy, Math.cos(base), Math.sin(base), '#ff5a3c');
    ctx.audio.explosion(0.6);
    ctx.shake(0.2);
    this.recoil = 1;
  }

  private spawnWaves(ctx: GameContext): void {
    ctx.shake(0.7);
    ctx.audio.stomp();
    ctx.vfx.dust(this.body.x, this.body.y, 20);
    ctx.vfx.ring(this.body.x, this.body.y + 0.2, '#ff7a3a', 3, 0.4);
    let n = 0;
    for (const dir of [-1, 1]) {
      const wave = this.waves[n];
      n += 1;
      wave.active = true;
      wave.x = this.body.x + dir * 1.2;
      wave.y = this.body.y;
      wave.dir = dir;
      wave.life = 2.2;
      wave.mesh.visible = true;
    }
  }

  private updateWaves(dt: number, ctx: GameContext): void {
    const p = ctx.player;
    for (const wave of this.waves) {
      if (!wave.active) continue;
      wave.x += wave.dir * 10 * dt;
      wave.life -= dt;
      if (wave.life <= 0 || ctx.level.solidAt(wave.x, wave.y + 0.5)) {
        wave.active = false;
        wave.mesh.visible = false;
        continue;
      }
      if (ctx.rng() < 0.7) ctx.vfx.sparks(wave.x, wave.y + 0.3, '#ff9a4a', 1, 3);
      wave.mesh.position.set(wave.x, wave.y, 0.3);
      wave.mesh.scale.set(1, 0.8 + Math.sin(ctx.time * 40) * 0.2, 1);
      if (p.alive && Math.abs(p.x - wave.x) < 0.8 && p.y < wave.y + 1.1) {
        p.damage(2, ctx, wave.dir);
      }
    }
  }

  sync(dt: number, time: number): void {
    const pose = this.pose;
    const speed = Math.abs(this.body.vx);
    pose.walkAmount += (Math.min(1, speed / 2.2) - pose.walkAmount) * Math.min(1, dt * 8);
    pose.walkPhase += speed * dt * 0.9;
    pose.airborne = !this.col.ground;
    pose.jet = this.state === 'dash' || this.state === 'dashTell' || this.state === 'intro' ? 1 : 0;
    pose.aim = this.state === 'volleyTell' || this.state === 'volley' ? 0.4 : 0;
    pose.recoil = this.recoil;
    pose.crouch = this.state === 'stompTell' ? this.telegraph * 0.8 : this.state === 'stunned' ? 0.7 : this.state === 'dashTell' ? 0.4 : 0;
    pose.telegraph = this.telegraph;
    pose.hurt = this.hurt;
    this.model.setFacing(this.facing);
    this.model.group.position.set(this.body.x, this.body.y, 0);
    this.model.update(pose, dt, time);
  }

  clearWaves(): void {
    for (const wave of this.waves) {
      wave.active = false;
      wave.mesh.visible = false;
    }
  }

  dispose(): void {
    this.model.dispose();
  }
}
