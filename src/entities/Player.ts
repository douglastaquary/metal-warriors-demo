import * as THREE from 'three';
import { createPose, MechModel } from '../graphics/MechModel';
import { PALETTE } from '../graphics/materials';
import { Tile, type Body, type CollisionResult } from '../levels/Level';
import type { GameContext, Intent } from '../game/types';

export const PLAYER_TUNING = {
  walkSpeed: 6.4,
  groundAccel: 62,
  airAccel: 34,
  gravity: 40,
  jumpVelocity: 14.2,
  jetAccel: 64,
  jetMaxRise: 7,
  maxFall: 24,
  energyMax: 100,
  jetDrain: 36,
  shieldDrain: 26,
  shieldBlockCost: 7,
  energyRegen: 34,
  fireInterval: 0.11,
  boltSpeed: 27,
  saberDuration: 0.26,
  saberCooldown: 0.36,
  armorMax: 12,
  invulnTime: 1.1,
};

export class Player {
  readonly model = new MechModel('nitro');
  readonly body: Body = { x: 0, y: 0, w: 1.2, h: 2.35, vx: 0, vy: 0 };
  readonly pose = createPose();
  private readonly collision: CollisionResult = { ground: false, ceiling: false, wall: 0, groundTile: Tile.Empty };

  facing = 1;
  armor = PLAYER_TUNING.armorMax;
  energy = PLAYER_TUNING.energyMax;
  spread = false;
  grounded = false;
  alive = true;
  invuln = 0;
  shielding = false;
  jetting = false;
  aim = 0;
  saberTimer = -1;
  distanceTravelled = 0;

  private fireCooldown = 0;
  private saberCooldown = 0;
  private regenDelay = 0;
  private hurtFlash = 0;
  private recoil = 0;
  private landSquash = 0;
  private coyote = 0;
  private jumpBuffer = 0;
  private jetLock = false;
  private electricTick = 0;
  private readonly muzzleWorld = new THREE.Vector3();

  get x(): number {
    return this.body.x;
  }

  get y(): number {
    return this.body.y;
  }

  get centerY(): number {
    return this.body.y + this.body.h / 2;
  }

  get saberActive(): boolean {
    return this.saberTimer >= 0.03 && this.saberTimer <= 0.2;
  }

  spawn(x: number, y: number, keepUpgrades = false): void {
    this.body.x = x;
    this.body.y = y;
    this.body.vx = 0;
    this.body.vy = 0;
    this.facing = 1;
    this.armor = PLAYER_TUNING.armorMax;
    this.energy = PLAYER_TUNING.energyMax;
    if (!keepUpgrades) this.spread = false;
    this.alive = true;
    this.invuln = 1.2;
    this.saberTimer = -1;
    this.shielding = false;
    this.jetting = false;
    this.hurtFlash = 0;
    this.model.group.visible = true;
    this.model.setFacing(1);
    this.syncModel(0, 0);
  }

  update(dt: number, intent: Intent, ctx: GameContext): void {
    if (!this.alive) return;
    const T = PLAYER_TUNING;
    this.invuln = Math.max(0, this.invuln - dt);
    this.fireCooldown = Math.max(0, this.fireCooldown - dt);
    this.saberCooldown = Math.max(0, this.saberCooldown - dt);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 5);
    this.recoil = Math.max(0, this.recoil - dt * 12);
    this.landSquash = Math.max(0, this.landSquash - dt * 5);
    this.coyote = this.grounded ? 0.1 : Math.max(0, this.coyote - dt);
    this.jumpBuffer = intent.jumpPressed ? 0.12 : Math.max(0, this.jumpBuffer - dt);

    this.shielding = intent.shieldHeld && this.energy > 2 && this.saberTimer < 0;
    const moveMul = this.shielding ? 0.35 : 1;

    if (intent.x !== 0 && !this.shielding) this.facing = intent.x > 0 ? 1 : -1;
    if (intent.x !== 0 && this.shielding && Math.sign(intent.x) !== this.facing && this.body.vx === 0) this.facing = Math.sign(intent.x);

    const target = intent.x * T.walkSpeed * moveMul;
    const accel = this.grounded ? T.groundAccel : T.airAccel;
    const dv = target - this.body.vx;
    this.body.vx += Math.sign(dv) * Math.min(Math.abs(dv), accel * dt);

    const dropThrough = intent.y < 0 && intent.jumpPressed && this.grounded;
    if (this.jumpBuffer > 0 && this.coyote > 0 && !dropThrough) {
      this.body.vy = T.jumpVelocity;
      this.grounded = false;
      this.coyote = 0;
      this.jumpBuffer = 0;
      this.jetLock = true;
      ctx.audio.jump();
      ctx.vfx.dust(this.body.x, this.body.y, 5);
    }
    if (!intent.jumpHeld) this.jetLock = false;
    if (!intent.jumpHeld && this.body.vy > 4 && !this.jetting) this.body.vy *= 0.86;

    this.jetting = false;
    const jetReady = !this.jetLock || this.body.vy < 3;
    if (!this.grounded && intent.jumpHeld && jetReady && this.energy > 0.5) {
      this.jetting = true;
      if (this.body.vy < T.jetMaxRise) this.body.vy = Math.min(T.jetMaxRise, this.body.vy + T.jetAccel * dt);
      this.energy = Math.max(0, this.energy - T.jetDrain * dt);
      this.regenDelay = 0.45;
      if (ctx.rng() < 0.7) ctx.vfx.jetTrail(this.body.x - this.facing * 0.6, this.body.y + 0.9);
    }
    this.body.vy = Math.max(-T.maxFall, this.body.vy - T.gravity * dt);
    const wasGrounded = this.grounded;
    const prevVy = this.body.vy;
    const prevX = this.body.x;
    ctx.level.move(this.body, dt, dropThrough, this.collision);
    this.grounded = this.collision.ground;
    this.distanceTravelled += Math.abs(this.body.x - prevX);

    if (this.grounded && !wasGrounded && prevVy < -6) {
      this.landSquash = Math.min(1, -prevVy / 20);
      ctx.audio.land();
      ctx.vfx.dust(this.body.x, this.body.y, 8);
      if (prevVy < -16) ctx.shake(0.18);
    }
    if (this.grounded && this.collision.groundTile === Tile.Electric) {
      this.electricTick -= dt;
      ctx.vfx.electric(this.body.x, this.body.y);
      if (this.electricTick <= 0) {
        this.electricTick = 0.4;
        this.damage(2, ctx, -this.facing, true);
        this.body.vy = 12;
        this.grounded = false;
      }
    }

    if (this.shielding) {
      this.energy = Math.max(0, this.energy - T.shieldDrain * dt);
      this.regenDelay = 0.45;
    }
    this.regenDelay = Math.max(0, this.regenDelay - dt);
    if (this.regenDelay <= 0 && !this.jetting && !this.shielding) {
      this.energy = Math.min(T.energyMax, this.energy + T.energyRegen * (this.grounded ? 1 : 0.35) * dt);
    }

    this.aim = intent.y > 0 ? 1 : intent.y < 0 && !this.grounded ? -1 : 0;

    if (intent.saberPressed && this.saberCooldown <= 0 && !this.shielding) {
      this.saberTimer = 0;
      this.saberCooldown = T.saberCooldown;
      ctx.audio.saber();
      ctx.vfx.saberArc(this.body.x + this.facing * 0.9, this.centerY + 0.2, this.facing);
    }
    if (this.saberTimer >= 0) {
      this.saberTimer += dt;
      if (this.saberTimer > T.saberDuration) this.saberTimer = -1;
    }

    if (intent.fireHeld && this.fireCooldown <= 0 && !this.shielding && this.saberTimer < 0) {
      this.fire(ctx);
    }

    if (this.grounded && Math.abs(this.body.vx) > 0.5) {
      const before = this.pose.walkPhase;
      if (Math.floor((before + Math.abs(this.body.vx) * dt * 1.35) / Math.PI) !== Math.floor(before / Math.PI)) {
        ctx.audio.footstep();
        ctx.vfx.dust(this.body.x - this.facing * 0.3, this.body.y, 2);
      }
    }
  }

  private fire(ctx: GameContext): void {
    const T = PLAYER_TUNING;
    this.fireCooldown = T.fireInterval;
    this.recoil = 1;
    this.model.group.updateMatrixWorld(true);
    this.model.muzzle.getWorldPosition(this.muzzleWorld);
    const base = this.aim * (Math.PI / 4);
    const angles = this.spread ? [base - 0.2, base, base + 0.2] : [base];
    // Bolts start at the shoulder line so point-blank targets between the body and the
    // muzzle are still hit; the flash stays on the muzzle.
    const originX = this.body.x + this.facing * 0.35;
    const originY = this.muzzleWorld.y - Math.tan(base) * Math.abs(this.muzzleWorld.x - originX);
    for (const a of angles) {
      const vx = Math.cos(a) * this.facing * T.boltSpeed;
      const vy = Math.sin(a) * T.boltSpeed;
      ctx.projectiles.spawn('player', 'bolt', originX, originY, vx, vy, 1, 0.9);
    }
    ctx.vfx.muzzle(this.muzzleWorld.x, this.muzzleWorld.y, Math.cos(base) * this.facing, Math.sin(base), PALETTE.plasmaPlayer);
    ctx.audio.shoot(this.spread);
  }

  /** Returns true if damage was applied. */
  damage(amount: number, ctx: GameContext, knockDir: number, ignoreInvuln = false): boolean {
    if (!this.alive || (this.invuln > 0 && !ignoreInvuln)) return false;
    this.armor = Math.max(0, this.armor - amount);
    this.invuln = PLAYER_TUNING.invulnTime;
    this.hurtFlash = 1;
    this.body.vx = knockDir * 7;
    if (this.grounded) this.body.vy = 6;
    ctx.audio.playerHit();
    ctx.shake(0.45);
    ctx.hitstop(70);
    ctx.flash('#ff3030', 0.25);
    ctx.vfx.sparks(this.body.x, this.centerY, '#ffb347', 12, 8);
    if (this.armor <= 0) this.alive = false;
    return true;
  }

  heal(amount: number): void {
    this.armor = Math.min(PLAYER_TUNING.armorMax, this.armor + amount);
    this.energy = PLAYER_TUNING.energyMax;
  }

  blockCost(): void {
    this.energy = Math.max(0, this.energy - PLAYER_TUNING.shieldBlockCost);
    this.regenDelay = 0.45;
  }

  syncModel(dt: number, time: number): void {
    const pose = this.pose;
    const speed = Math.abs(this.body.vx);
    pose.walkAmount += ((this.grounded ? Math.min(1, speed / PLAYER_TUNING.walkSpeed) : 0) - pose.walkAmount) * Math.min(1, dt * 12);
    pose.walkPhase += speed * dt * 1.35;
    pose.airborne = !this.grounded;
    pose.jet += ((this.jetting ? 1 : 0) - pose.jet) * Math.min(1, dt * 18);
    pose.aim += (this.aim - pose.aim) * Math.min(1, dt * 20);
    pose.recoil = this.recoil;
    pose.slash = this.saberTimer >= 0 ? Math.min(1, this.saberTimer / PLAYER_TUNING.saberDuration) : -1;
    pose.shield += ((this.shielding ? 1 : 0) - pose.shield) * Math.min(1, dt * 20);
    pose.crouch = this.landSquash * 0.8 + (this.shielding ? 0.25 : 0);
    const blink = this.invuln > 0 && Math.floor(this.invuln * 16) % 2 === 0 ? 0.35 : 0;
    pose.hurt = Math.max(this.hurtFlash, blink);
    this.model.setFacing(this.facing);
    this.model.group.position.set(this.body.x, this.body.y, 0);
    this.model.update(pose, dt, time);
  }
}
