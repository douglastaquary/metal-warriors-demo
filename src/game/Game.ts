import * as THREE from 'three';
import { InputController } from '../core/InputController';
import { Loop } from '../core/Loop';
import { createRenderer, PixelPipeline, VIEW_HEIGHT_UNITS } from '../core/Renderer';
import { Boss } from '../entities/Boss';
import { Drone, Enemy, Trooper, Turret } from '../entities/Enemies';
import { Pickup } from '../entities/Pickup';
import { Player, PLAYER_TUNING } from '../entities/Player';
import { Projectiles } from '../entities/Projectiles';
import { PALETTE } from '../graphics/materials';
import { CheckpointBeacon } from '../graphics/Props';
import { Vfx } from '../graphics/Vfx';
import { World } from '../graphics/World';
import { Level } from '../levels/Level';
import { AudioSystem } from '../systems/AudioSystem';
import { CameraRig, type CameraBounds } from '../systems/CameraRig';
import { DebugTools, type DebugTuning } from '../systems/DebugTools';
import { Hud, type OverlayName } from '../systems/Hud';
import { createSeededRandom } from '../utils/random';
import { emptyIntent, type GameContext, type Intent } from './types';

type GameState = 'title' | 'playing' | 'paused' | 'dying' | 'gameover' | 'clear';

const STEP = 1 / 120;
const START_LIVES = 3;
const ARENA_ZOOM = 0.86;
const ARENA_FOCUS_MAX_Y = 8.4;
const TEST_STATES = ['title', 'active-play', 'combat', 'jetpack', 'boss', 'paused', 'game-over', 'stage-clear'] as const;

export class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly pipeline: PixelPipeline;
  private readonly scene = new THREE.Scene();
  private readonly rig = new CameraRig();
  private readonly input: InputController;
  private readonly audio = new AudioSystem();
  private readonly hud = new Hud();
  private readonly level = new Level();
  private readonly world: World;
  private readonly projectiles = new Projectiles();
  private readonly vfx: Vfx;
  private readonly player = new Player();
  private readonly enemyLayer = new THREE.Group();
  private enemies: Enemy[] = [];
  private boss: Boss | null = null;
  private readonly pickups: Pickup[] = [];
  private readonly beacons: CheckpointBeacon[] = [];
  private readonly loop = new Loop(
    (delta, elapsed) => this.frame(delta, elapsed),
    () => this.render(),
  );
  private readonly tuning: DebugTuning = { exposure: 1.0, maxDpr: 2, outline: 0.85, walkSpeed: PLAYER_TUNING.walkSpeed, jetAccel: PLAYER_TUNING.jetAccel };
  private readonly debugTools: DebugTools;

  private state: GameState = 'title';
  private seedValue = 1;
  private rng = createSeededRandom(1);
  private accumulator = 0;
  private hitstopRemaining = 0;
  private time = 0;
  private frameCount = 0;
  private runTime = 0;
  private score = 0;
  private lives = START_LIVES;
  private kills = 0;
  private deaths = 0;
  private checkpointIndex = -1;
  private sectionShown = -1;
  private bossStarted = false;
  private clearTimer = -1;
  private dyingTimer = 0;
  private saberSwing = -1;
  private readonly saberHits = new Set<Enemy>();
  private pausedForScreenshot = false;
  private reducedMotion = false;
  private scripted: Intent | null = null;
  private readonly intent = emptyIntent();
  private readonly ctx: GameContext;
  private readonly tmp = new THREE.Vector3();
  private readonly cameraBounds: CameraBounds;
  private readonly arenaBounds: CameraBounds;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = createRenderer(canvas);
    this.renderer.info.autoReset = false;
    this.pipeline = new PixelPipeline(this.renderer);
    this.vfx = new Vfx(this.rng);
    this.audio.rng = this.rng;

    const buttons = Array.from(document.querySelectorAll<HTMLElement>('.pad-btn'));
    this.input = new InputController(this.el('#touch-stick'), this.el('#touch-knob'), buttons);
    this.detectTouch();

    this.world = new World(this.level);
    this.cameraBounds = { minX: 0, maxX: this.level.width, minY: 0, maxY: this.level.height };
    this.arenaBounds = { minX: this.level.gateX, maxX: this.level.arenaMaxX, minY: 0, maxY: this.level.height };

    this.ctx = this.createContext();
    this.buildScene();
    this.debugTools = new DebugTools(this.tuning, () => this.applyTuning());
    this.bindUi();
    this.hud.setMarkers(
      this.level.checkpoints.map((x) => x / this.level.width),
      this.level.arenaTriggerX / this.level.width,
    );
    this.resetStage();
    this.enterTitle();
    this.installTestHooks();
    this.publishDiagnostics();
  }

  start(): void {
    this.loop.start();
  }

  dispose(): void {
    this.loop.stop();
    this.input.dispose();
    this.audio.dispose();
    this.debugTools.dispose();
    for (const e of this.enemies) e.dispose();
    this.boss?.dispose();
    this.player.model.dispose();
    this.vfx.dispose();
    this.pipeline.dispose();
    this.renderer.dispose();
    window.__THREE_GAME_DIAGNOSTICS__ = undefined;
    window.__THREE_GAME_TEST_HOOKS__ = undefined;
  }

  // ---------------------------------------------------------------------------
  // Setup

  private el(selector: string): HTMLElement {
    const node = document.querySelector<HTMLElement>(selector);
    if (!node) throw new Error(`Missing element: ${selector}`);
    return node;
  }

  private detectTouch(): void {
    const coarse = window.matchMedia?.('(pointer: coarse)').matches;
    const touch = coarse || 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    document.body.classList.toggle('touch', Boolean(touch));
  }

  private createContext(): GameContext {
    return {
      level: this.level,
      vfx: this.vfx,
      audio: this.audio,
      projectiles: this.projectiles,
      player: this.player,
      rng: () => this.rng(),
      time: 0,
      shake: (amount) => this.rig.addTrauma(amount),
      hitstop: (ms) => {
        this.hitstopRemaining = Math.max(this.hitstopRemaining, ms / 1000);
        this.audio.duck(0.6, ms / 1000 + 0.1);
      },
      flash: (color, strength) => {
        if (!this.reducedMotion) this.hud.screenFlash(color, strength);
      },
      addScore: (points, x, y) => {
        this.score += points;
        const p = this.worldToScreen(x, y);
        this.hud.popup(String(points), p.x, p.y, points >= 1000);
      },
      spawnDrone: (x, y) => {
        const drone = new Drone(x, y, this.ctx.rng);
        drone.awake = true;
        drone.sync(0, 0);
        this.enemies.push(drone);
        this.enemyLayer.add(drone.group);
        this.vfx.ring(x, y, PALETTE.enemyEye, 1.6);
      },
      enemyKilled: () => {
        this.kills += 1;
      },
    };
  }

  private buildScene(): void {
    this.scene.background = new THREE.Color('#060818');
    this.scene.add(new THREE.HemisphereLight('#a8b8ff', '#2a1830', 1.3));
    const key = new THREE.DirectionalLight('#fff0dc', 2.6);
    key.position.set(-0.45, 0.8, 1);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight('#b77bff', 1.4);
    rim.position.set(1, 0.4, -0.8);
    this.scene.add(rim);
    this.scene.add(new THREE.AmbientLight('#303a60', 0.6));

    this.scene.add(this.world.group);
    this.scene.add(this.enemyLayer);
    this.scene.add(this.player.model.group);
    this.scene.add(this.player.model.shadow);
    this.scene.add(this.projectiles.group);
    this.scene.add(this.vfx.group);

    for (const spawn of this.level.pickups) {
      const pickup = new Pickup(spawn.kind, spawn.x, spawn.y);
      this.pickups.push(pickup);
      this.scene.add(pickup.group);
    }
    for (const x of this.level.checkpoints) {
      const beacon = new CheckpointBeacon();
      beacon.group.position.set(x + 0.5, this.level.groundBelow(x + 0.5, 12), -1.1);
      this.beacons.push(beacon);
      this.scene.add(beacon.group);
    }
    if (import.meta.env.DEV) Object.assign(window, { __GAME_DEBUG__: { scene: this.scene, camera: this.rig.camera } });
  }

  private applyTuning(): void {
    this.pipeline.material.uniforms.exposure.value = this.tuning.exposure;
    this.pipeline.material.uniforms.outlineStrength.value = this.tuning.outline;
    PLAYER_TUNING.walkSpeed = this.tuning.walkSpeed;
    PLAYER_TUNING.jetAccel = this.tuning.jetAccel;
    this.pipeline.resize(this.rig.camera, this.tuning.maxDpr);
  }

  private bindUi(): void {
    document.querySelectorAll<HTMLButtonElement>('[data-action]').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.preventDefault();
        void this.audio.unlock();
        this.handleAction(button.dataset.action ?? '');
        button.blur();
      });
    });
  }

  private handleAction(action: string): void {
    switch (action) {
      case 'start':
        this.audio.uiSelect();
        this.beginPlay();
        break;
      case 'pause':
        if (this.state === 'playing') this.setPaused(true);
        else if (this.state === 'paused') this.setPaused(false);
        break;
      case 'resume':
        this.audio.uiSelect();
        this.setPaused(false);
        break;
      case 'restart':
        this.audio.uiSelect();
        this.resetStage();
        this.beginPlay();
        break;
      case 'continue':
        this.audio.uiSelect();
        this.continueFromCheckpoint();
        break;
      case 'mute':
        this.audio.setMuted(!this.audio.isMuted);
        this.hud.setMuted(this.audio.isMuted);
        break;
    }
  }

  // ---------------------------------------------------------------------------
  // Flow

  private setState(state: GameState, overlay: OverlayName): void {
    this.state = state;
    this.hud.setAppState(state);
    this.hud.showOverlay(overlay);
  }

  private enterTitle(): void {
    this.setState('title', 'title');
    this.audio.playMusic('title');
    this.player.model.body.rotation.y = -0.55;
    this.player.syncModel(0, 0);
    this.pipeline.resize(this.rig.camera, this.tuning.maxDpr);
    this.updateTitleCamera(1, this.pipeline.height > 1 ? VIEW_HEIGHT_UNITS / this.pipeline.height : 0);
  }

  private beginPlay(): void {
    this.player.model.body.rotation.y = 0;
    this.rig.setZoom(1);
    this.rig.setOffset(0, 0);
    this.input.clearPresses();
    this.setState('playing', null);
    this.audio.playMusic(this.bossStarted ? 'boss' : 'stage');
    if (this.runTime === 0) this.hud.showBanner('STAGE 1', 'ORBITAL FOUNDRY', '', 2200);
  }

  private setPaused(paused: boolean): void {
    if (paused && this.state === 'playing') {
      this.setState('paused', 'pause');
      this.audio.setPaused(true);
      this.input.releaseAll();
    } else if (!paused && this.state === 'paused') {
      this.setState('playing', null);
      this.audio.setPaused(false);
      this.input.clearPresses();
    }
  }

  private resetStage(): void {
    this.score = 0;
    this.lives = START_LIVES;
    this.kills = 0;
    this.deaths = 0;
    this.runTime = 0;
    this.checkpointIndex = -1;
    this.sectionShown = -1;
    this.clearTimer = -1;
    this.rng = createSeededRandom(this.seedValue);
    this.vfx.rng = this.ctx.rng;
    this.audio.rng = this.ctx.rng;
    for (const e of this.enemies) {
      this.enemyLayer.remove(e.group);
      if (e instanceof Trooper) this.enemyLayer.remove(e.laserMesh);
      e.dispose();
    }
    this.enemies = [];
    for (const spawn of this.level.enemies) {
      let enemy: Enemy;
      if (spawn.kind === 'drone') enemy = new Drone(spawn.x, spawn.y, this.ctx.rng);
      else if (spawn.kind === 'trooper') {
        const trooper = new Trooper(spawn.x, spawn.y, this.ctx.rng);
        this.enemyLayer.add(trooper.laserMesh);
        enemy = trooper;
      } else enemy = new Turret(spawn.x, spawn.y, spawn.mount ?? 'floor', this.ctx.rng);
      enemy.sync(0, 0);
      this.enemies.push(enemy);
      this.enemyLayer.add(enemy.group);
    }
    for (const p of this.pickups) p.reset();
    for (const b of this.beacons) b.reset();
    this.removeBoss();
    this.player.spawn(this.level.playerStart.x, this.level.playerStart.y);
    this.player.spread = false;
    this.projectiles.clear();
    this.vfx.clear();
    this.rig.snap(this.player.x, this.player.centerY + 1.5, 1, this.cameraBounds);
    this.hud.clearBanner();
  }

  private removeBoss(): void {
    if (this.boss) {
      this.enemyLayer.remove(this.boss.group);
      for (const w of this.boss.waves) this.enemyLayer.remove(w.mesh);
      this.boss.dispose();
      this.boss = null;
    }
    this.bossStarted = false;
    this.level.gateClosed = false;
    this.world.setGate(false);
    this.rig.setZoom(1, true);
    this.enemies = this.enemies.filter((e) => {
      const summoned = e instanceof Drone && e.x > this.level.gateX && !this.level.enemies.some((s) => s.x === e.x);
      if (summoned) {
        this.enemyLayer.remove(e.group);
        e.dispose();
      }
      return !summoned;
    });
  }

  private respawnPoint(): { x: number; y: number } {
    if (this.checkpointIndex < 0) return this.level.playerStart;
    const x = this.level.checkpoints[this.checkpointIndex] + 1.5;
    return { x, y: this.level.groundBelow(x, 12) };
  }

  private respawn(): void {
    if (this.bossStarted) this.removeBoss();
    const p = this.respawnPoint();
    this.player.spawn(p.x, p.y, false);
    this.projectiles.clear();
    this.rig.snap(this.player.x, this.player.centerY + 1.5, 1, this.cameraBounds);
    this.setState('playing', null);
    this.audio.playMusic('stage');
    this.hud.showBanner('READY', `${this.lives} MECH${this.lives === 1 ? '' : 'S'} LEFT`, '', 1400);
  }

  private continueFromCheckpoint(): void {
    this.lives = START_LIVES;
    this.score = Math.floor(this.score / 2);
    this.respawn();
  }

  private startBoss(): void {
    this.bossStarted = true;
    this.level.gateClosed = true;
    this.world.setGate(true);
    this.rig.setZoom(ARENA_ZOOM);
    const boss = new Boss(this.level.bossSpawn.x, this.level.bossSpawn.y);
    this.boss = boss;
    this.enemyLayer.add(boss.group);
    for (const w of boss.waves) this.enemyLayer.add(w.mesh);
    boss.begin(this.ctx);
    this.audio.playMusic('boss');
    this.hud.showBanner('WARNING', 'GUARDIAN HAVOC APPROACHING', 'warning', 2400);
  }

  // ---------------------------------------------------------------------------
  // Frame

  private frame(delta: number, elapsed: number): void {
    this.frameCount += 1;
    if (this.pipeline.resize(this.rig.camera, this.tuning.maxDpr)) {
      this.vfx.setPixelScale(this.pipeline.height / (2 * Math.tan(THREE.MathUtils.degToRad(this.rig.fov / 2))));
    }
    if (this.pausedForScreenshot) return;
    this.input.poll();
    this.handleGlobalInput();

    const animTime = this.reducedMotion ? 0 : elapsed;
    if (this.state === 'playing' || this.state === 'dying') {
      let scale = 1;
      if (this.hitstopRemaining > 0) {
        this.hitstopRemaining -= delta;
        scale = 0.05;
      }
      this.accumulator += delta * scale;
      let steps = 0;
      while (this.accumulator >= STEP && steps < 12) {
        this.step(STEP);
        this.accumulator -= STEP;
        steps += 1;
      }
    } else if (this.state === 'title') {
      this.player.model.body.rotation.y = -0.55 + Math.sin(elapsed * 0.6) * 0.12;
    }

    this.syncVisuals(delta, animTime);
  }

  private handleGlobalInput(): void {
    const i = this.input;
    if (this.state === 'title') {
      if (i.consume('start') || i.consume('jump') || i.consume('fire')) {
        void this.audio.unlock();
        this.audio.uiSelect();
        this.beginPlay();
      }
      return;
    }
    if (i.consume('pause') || (this.state === 'playing' && i.consume('start'))) {
      this.handleAction('pause');
      return;
    }
    if (this.state === 'paused' && i.consume('start')) this.setPaused(false);
    if (this.state === 'gameover' && i.consume('start')) this.continueFromCheckpoint();
    if (this.state === 'clear' && i.consume('start')) {
      this.resetStage();
      this.beginPlay();
    }
  }

  private readIntent(): Intent {
    if (this.scripted) {
      const s = this.scripted;
      const out = { ...s };
      s.jumpPressed = false;
      s.saberPressed = false;
      return out;
    }
    const i = this.input;
    const t = this.intent;
    t.x = i.axis.x;
    t.y = i.axis.y;
    t.jumpHeld = i.isHeld('jump');
    t.jumpPressed = i.consume('jump');
    t.fireHeld = i.isHeld('fire');
    t.saberPressed = i.consume('saber');
    t.shieldHeld = i.isHeld('shield');
    return t;
  }

  private step(dt: number): void {
    this.time += dt;
    this.ctx.time = this.time;
    const player = this.player;

    if (this.state === 'playing') {
      this.runTime += dt;
      player.update(dt, this.readIntent(), this.ctx);
    }

    const halfW = this.rig.halfWidth;
    const camX = this.rig.position.x;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      if (!e.awake && Math.abs(e.x - camX) < halfW + 2.5) e.awake = true;
      if (e.awake && Math.abs(e.x - camX) < halfW + 22) e.update(dt, this.ctx);
    }
    if (this.boss && (this.boss.alive || !this.boss.finished)) this.boss.update(dt, this.ctx);

    this.projectiles.update(dt, this.level, this.vfx, this.time);
    this.resolveCombat();
    this.checkProgress();

    if (this.state === 'playing' && !player.alive) this.killPlayer();
    if (this.state === 'dying') {
      this.dyingTimer -= dt;
      if (this.dyingTimer <= 0) {
        this.lives -= 1;
        if (this.lives > 0) this.respawn();
        else {
          this.hud.setGameOverScore(this.score);
          this.setState('gameover', 'gameover');
          this.audio.playMusic('none');
          this.audio.jingle('gameover');
        }
      }
    }
    if (this.clearTimer >= 0) {
      this.clearTimer -= dt;
      if (this.clearTimer < 0) this.finishStage();
    }
  }

  private killPlayer(): void {
    this.deaths += 1;
    this.state = 'dying';
    this.hud.setAppState('dying');
    this.dyingTimer = 2.2;
    this.player.model.group.visible = false;
    this.vfx.explosion(this.player.x, this.player.centerY, 2);
    this.audio.explosion(2);
    this.audio.jingle('death');
    this.audio.setJet(0);
    this.rig.addTrauma(0.9);
    this.ctx.flash('#ffffff', 0.5);
  }

  private finishStage(): void {
    const timeBonus = Math.max(0, Math.floor(600 - this.runTime) * 10);
    this.score += timeBonus + this.lives * 1000;
    this.hud.setClearStats(this.score, this.runTime, this.kills, this.deaths);
    this.hud.clearBanner();
    this.setState('clear', 'clear');
    this.audio.playMusic('none');
    this.audio.jingle('clear');
  }

  private resolveCombat(): void {
    const player = this.player;
    const pb = player.body;
    const px0 = pb.x - pb.w / 2;
    const px1 = pb.x + pb.w / 2;
    const targets: Enemy[] = this.boss ? [...this.enemies, this.boss] : this.enemies;

    if (player.saberTimer >= 0 && player.saberTimer < this.saberSwing) this.saberHits.clear();
    this.saberSwing = player.saberTimer;
    const saberX0 = player.facing > 0 ? pb.x + 0.1 : pb.x - 2.7;
    const saberX1 = player.facing > 0 ? pb.x + 2.7 : pb.x - 0.1;
    const saberY0 = pb.y + 0.1;
    const saberY1 = pb.y + 2.9;

    for (const p of this.projectiles.list) {
      if (!p.active) continue;
      if (p.owner === 'player') {
        for (const e of targets) {
          if (!e.alive || !e.awake || !e.overlaps(p.x, p.y, p.radius)) continue;
          p.active = false;
          if (e.blocks(p)) {
            this.vfx.sparks(p.x, p.y, '#ff7ad1', 6, 6);
            this.audio.shieldBlock();
          } else {
            this.vfx.sparks(p.x, p.y, PALETTE.plasmaPlayer, 6, 6);
            e.damage(p.damage, this.ctx);
          }
          break;
        }
      } else if (player.alive && this.state === 'playing') {
        if (player.saberActive && p.x > saberX0 && p.x < saberX1 && p.y > saberY0 && p.y < saberY1) {
          this.projectiles.reflect(p, player.facing);
          this.vfx.sparks(p.x, p.y, PALETTE.saber, 10, 8);
          this.vfx.ring(p.x, p.y, PALETTE.saber, 1.2, 0.2);
          this.audio.deflect();
          this.ctx.hitstop(35);
          this.ctx.addScore(10, p.x, p.y);
          continue;
        }
        const hit = p.x + p.radius > px0 && p.x - p.radius < px1 && p.y + p.radius > pb.y && p.y - p.radius < pb.y + pb.h;
        if (!hit) continue;
        p.active = false;
        if (player.shielding && Math.sign(p.vx) === -player.facing) {
          player.blockCost();
          this.vfx.sparks(p.x, p.y, '#5cf2ff', 8, 6);
          this.vfx.ring(p.x, p.y, '#5cf2ff', 1, 0.18);
          this.audio.shieldBlock();
        } else {
          player.damage(p.damage, this.ctx, Math.sign(p.vx) || -player.facing);
        }
      }
    }

    if (player.saberActive) {
      for (const e of targets) {
        if (!e.alive || !e.awake || this.saberHits.has(e)) continue;
        if (!e.overlapsBox(saberX0, saberY0, saberX1, saberY1)) continue;
        this.saberHits.add(e);
        this.vfx.sparks(e.cx, e.cy, PALETTE.saber, 14, 10);
        this.ctx.hitstop(55);
        this.rig.addTrauma(0.25);
        e.damage(4, this.ctx, true);
      }
    }

    if (player.alive && this.state === 'playing') {
      for (const e of targets) {
        if (!e.alive || !e.awake || e.contactDamage <= 0) continue;
        if (e.overlapsBox(px0 + 0.15, pb.y + 0.1, px1 - 0.15, pb.y + pb.h - 0.1)) {
          const dmg = e instanceof Boss && e.state === 'dash' ? 3 : e.contactDamage;
          player.damage(dmg, this.ctx, Math.sign(pb.x - e.x) || -player.facing);
        }
      }
    }
  }

  private checkProgress(): void {
    const player = this.player;
    if (this.state !== 'playing') return;

    for (const pickup of this.pickups) {
      if (!pickup.active) continue;
      if (Math.abs(pickup.x - player.x) < 1 && Math.abs(pickup.y - player.centerY) < 1.4) {
        pickup.collect();
        const p = this.worldToScreen(pickup.x, pickup.y + 0.8);
        this.vfx.ring(pickup.x, pickup.y, pickup.kind === 'repair' ? PALETTE.energy : '#ffb347', 1.8);
        this.vfx.sparks(pickup.x, pickup.y, pickup.kind === 'repair' ? PALETTE.energy : '#ffb347', 12, 6);
        this.rig.addTrauma(0.1);
        if (pickup.kind === 'repair') {
          player.heal(5);
          this.audio.pickup();
          this.hud.popup('REPAIR', p.x, p.y);
        } else if (pickup.kind === 'spread') {
          player.spread = true;
          this.audio.powerUp();
          this.hud.showBanner('SPREAD SHOT', 'FUSION RIFLE UPGRADED', 'good', 1600);
        } else {
          this.lives += 1;
          this.audio.powerUp();
          this.hud.popup('1UP', p.x, p.y, true);
        }
        this.score += 50;
      }
    }

    for (let i = 0; i < this.level.checkpoints.length; i += 1) {
      if (i > this.checkpointIndex && player.x > this.level.checkpoints[i] + 0.5) {
        this.checkpointIndex = i;
        this.beacons[i].activate();
        this.audio.checkpoint();
        this.hud.showBanner('CHECKPOINT', '', 'good', 1200);
      }
    }

    const section = this.level.sectionIndexAt(player.x);
    if (section > this.sectionShown) {
      if (this.sectionShown >= 0 && section < 3) this.hud.showBanner(this.level.sections[section].name, `AREA ${section + 1}`, '', 1600);
      this.sectionShown = section;
    }

    if (!this.bossStarted && player.x > this.level.arenaTriggerX) this.startBoss();
    if (this.boss && this.boss.finished && this.clearTimer < 0 && this.state === 'playing') {
      this.clearTimer = 1.8;
      this.hud.showBanner('GUARDIAN DESTROYED', '', 'good', 1800);
    }
  }

  private syncVisuals(delta: number, animTime: number): void {
    const player = this.player;
    player.syncModel(delta, animTime);
    const ground = this.level.groundBelow(player.x, player.y + 0.2);
    player.model.shadow.position.set(player.x, ground + 0.02, -1.1);
    const lift = Math.max(0, player.y - ground);
    player.model.shadow.scale.setScalar(Math.max(0.3, 1 - lift * 0.12));
    player.model.shadow.visible = player.model.group.visible;

    for (const e of this.enemies) if (e.alive && e.awake) e.sync(delta, animTime);
    for (const e of this.enemies) if (!e.awake && e.alive) e.sync(0, 0);
    if (this.boss) this.boss.sync(delta, animTime);
    for (const p of this.pickups) p.update(delta, animTime);
    for (const b of this.beacons) b.update(animTime);
    this.world.update(animTime, this.rig.position.x);
    this.vfx.update(this.reducedMotion ? 0 : delta);
    this.audio.setJet(this.state === 'playing' && player.jetting ? 1 : 0);

    const pixelWorld = VIEW_HEIGHT_UNITS / this.pipeline.height;
    if (this.state === 'title') {
      this.updateTitleCamera(delta, pixelWorld);
    } else {
      const bounds = this.bossStarted ? this.arenaBounds : this.cameraBounds;
      // The arena camera keeps the floor in frame so stomp shockwaves stay readable.
      const focusY = this.bossStarted ? Math.min(player.centerY + 1.4, ARENA_FOCUS_MAX_Y) : player.centerY + 1.4;
      // Frame player and guardian together instead of leading with facing look-ahead.
      const boss = this.boss && this.bossStarted && !this.boss.finished ? this.boss : null;
      const focusX = boss ? player.x + (boss.cx - player.x) * 0.45 : player.x;
      this.rig.update(delta, focusX, focusY, boss ? 0 : player.facing, bounds, pixelWorld);
    }
  }

  private updateTitleCamera(delta: number, pixelWorld: number): void {
    const windowEl = document.querySelector<HTMLElement>('.mech-window');
    const zoom = 1.15;
    this.rig.setZoom(zoom, true);
    let fx = 0.3;
    let fy = 0.45;
    if (windowEl) {
      const w = windowEl.getBoundingClientRect();
      const c = this.canvas.getBoundingClientRect();
      if (w.width > 0 && c.width > 0) {
        fx = (w.left + w.width / 2 - c.left) / c.width;
        fy = (w.top + w.height / 2 - c.top) / c.height;
      }
    }
    const hw = this.rig.halfWidth / zoom;
    const hh = VIEW_HEIGHT_UNITS / 2 / zoom;
    this.rig.setOffset(-(fx - 0.5) * 2 * hw, (fy - 0.5) * 2 * hh);
    const loose: CameraBounds = { minX: -100, maxX: 400, minY: -100, maxY: 100 };
    this.rig.update(delta, this.player.x, this.player.centerY, 0, loose, pixelWorld);
  }

  private worldToScreen(x: number, y: number): { x: number; y: number } {
    this.tmp.set(x, y, 0).project(this.rig.camera);
    return { x: (this.tmp.x + 1) / 2, y: (1 - this.tmp.y) / 2 };
  }

  private render(): void {
    // Reset per render (not per frame) so out-of-band renders from test hooks aren't double counted.
    this.renderer.info.reset();
    this.pipeline.render(this.scene, this.rig.camera);
    this.updateHud();
    this.publishDiagnostics();
  }

  private updateHud(): void {
    const boss = this.boss;
    this.hud.update({
      armor: this.player.armor,
      armorMax: PLAYER_TUNING.armorMax,
      energy: this.player.energy,
      energyMax: PLAYER_TUNING.energyMax,
      lives: this.lives,
      score: this.score,
      spread: this.player.spread,
      section: this.level.sections[this.level.sectionIndexAt(this.player.x)].name,
      progress: this.player.x / this.level.width,
      bossVisible: Boolean(boss && this.bossStarted && !boss.finished),
      bossRatio: boss ? boss.hp / boss.maxHp : 0,
    });
  }

  // ---------------------------------------------------------------------------
  // Test hooks

  private simulate(seconds: number, intent: Partial<Intent>): void {
    this.scripted = { ...emptyIntent(), ...intent };
    const steps = Math.round(seconds / STEP);
    for (let i = 0; i < steps; i += 1) {
      this.step(STEP);
      if (i % 4 === 0) this.syncVisuals(STEP * 4, this.time);
    }
    this.scripted = null;
    this.syncVisuals(STEP, this.time);
  }

  private teleport(x: number, facing = 1, fromY = 14): void {
    const y = this.level.groundBelow(x, fromY);
    this.player.body.x = x;
    this.player.body.y = y;
    this.player.body.vx = 0;
    this.player.body.vy = 0;
    this.player.facing = facing;
    for (let i = 0; i < this.level.checkpoints.length; i += 1) {
      if (x > this.level.checkpoints[i] + 0.5) {
        this.checkpointIndex = i;
        this.beacons[i].activate();
      }
    }
    this.sectionShown = this.level.sectionIndexAt(x);
    this.rig.snap(x, this.player.centerY + 1.4, facing, this.bossStarted ? this.arenaBounds : this.cameraBounds);
  }

  private applyTestState(name: string): void {
    this.resetStage();
    this.hud.clearBanner();
    switch (name) {
      case 'title':
        this.enterTitle();
        break;
      case 'active-play':
        this.beginPlay();
        this.hud.clearBanner();
        this.simulate(1.6, { x: 1 });
        this.simulate(1.0, { x: 0.4, fireHeld: true, y: 1 });
        break;
      case 'combat':
        this.beginPlay();
        this.hud.clearBanner();
        this.teleport(58, 1);
        this.simulate(1.3, { x: 1 });
        this.simulate(0.8, { fireHeld: true, y: 0 });
        this.simulate(0.2, { saberPressed: true });
        break;
      case 'jetpack':
        this.beginPlay();
        this.hud.clearBanner();
        this.teleport(98, 1);
        this.simulate(0.05, { jumpPressed: true, jumpHeld: true, x: 1 });
        this.simulate(0.7, { jumpHeld: true, x: 1, fireHeld: true, y: 1 });
        break;
      case 'boss':
        this.beginPlay();
        this.hud.clearBanner();
        this.teleport(140, 1, 4);
        this.simulate(0.3, { x: 1 });
        this.simulate(2.6, { fireHeld: true });
        this.simulate(0.6, { fireHeld: true, jumpPressed: true, jumpHeld: true });
        this.hud.clearBanner();
        break;
      case 'paused':
        this.beginPlay();
        this.hud.clearBanner();
        this.teleport(24, 1);
        this.simulate(0.8, { fireHeld: true });
        this.setPaused(true);
        break;
      case 'game-over':
        this.beginPlay();
        this.hud.clearBanner();
        this.teleport(50, 1);
        this.lives = 1;
        this.player.armor = 0;
        this.player.alive = false;
        this.simulate(2.6, {});
        break;
      case 'stage-clear':
        this.beginPlay();
        this.hud.clearBanner();
        this.teleport(140, 1, 4);
        this.simulate(0.3, { x: 1 });
        this.simulate(2.4, {});
        if (this.boss) {
          this.boss.damage(this.boss.maxHp * 2, this.ctx);
          this.simulate(5.2, {});
        }
        break;
      default:
        throw new Error(`Unknown test state: ${name}`);
    }
    // Captures may freeze before the next frame; place every entity now.
    this.syncVisuals(0, this.reducedMotion ? 0 : this.time);
  }

  private installTestHooks(): void {
    window.__THREE_GAME_TEST_HOOKS__ = {
      seed: (value: number) => {
        this.seedValue = value;
        this.rng = createSeededRandom(value);
      },
      setState: (name: string) => {
        if (!(TEST_STATES as readonly string[]).includes(name)) throw new Error(`Unknown test state: ${name}`);
        this.applyTestState(name);
        this.render();
        this.publishDiagnostics();
        return { state: name };
      },
      setPausedForScreenshot: (paused: boolean) => {
        this.pausedForScreenshot = paused;
        if (paused) this.audio.setJet(0);
      },
      setReducedMotion: (enabled: boolean) => {
        this.reducedMotion = enabled;
        this.rig.reducedMotion = enabled;
        document.body.classList.toggle('reduced-motion', enabled);
        this.render();
        this.publishDiagnostics();
      },
      hideDebugUi: (hidden: boolean) => {
        this.debugTools.setHidden(hidden);
      },
    };
  }

  private publishDiagnostics(): void {
    const info = this.renderer.info;
    const player = this.player;
    window.__THREE_GAME_DIAGNOSTICS__ = {
      frame: this.frameCount,
      elapsed: this.runTime,
      score: this.score,
      targetScore: 0,
      complete: this.state === 'clear',
      state: this.state,
      lives: this.lives,
      kills: this.kills,
      deaths: this.deaths,
      checkpoint: this.checkpointIndex,
      bossHp: this.boss ? this.boss.hp : null,
      bossState: this.boss ? this.boss.state : null,
      enemiesAlive: this.enemies.filter((e) => e.alive).length,
      projectiles: this.projectiles.list.filter((p) => p.active).length,
      particles: this.vfx.lastAlive,
      audio: this.audio.state,
      player: {
        position: { x: player.x, y: player.y, z: 0 },
        speed: Math.hypot(player.body.vx, player.body.vy),
        armor: player.armor,
        energy: player.energy,
        grounded: player.grounded,
        jetting: player.jetting,
        spread: player.spread,
        distanceTravelled: player.distanceTravelled,
      },
      renderer: {
        calls: info.render.calls,
        triangles: info.render.triangles,
        geometries: info.memory.geometries,
        textures: info.memory.textures,
        programs: info.programs?.length ?? 0,
      },
      canvas: {
        clientWidth: this.canvas.clientWidth,
        clientHeight: this.canvas.clientHeight,
        width: this.canvas.width,
        height: this.canvas.height,
        dpr: Math.min(window.devicePixelRatio || 1, this.tuning.maxDpr),
        pixelTarget: { width: this.pipeline.width, height: this.pipeline.height, scale: this.pipeline.scale },
      },
    };
  }
}
