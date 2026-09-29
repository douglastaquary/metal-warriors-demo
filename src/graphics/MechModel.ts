import * as THREE from 'three';
import { glow, PALETTE, textures, toon } from './materials';

export type MechVariant = 'nitro' | 'trooper' | 'havoc';

export interface MechPose {
  walkPhase: number;
  walkAmount: number;
  airborne: boolean;
  jet: number;
  aim: number;
  recoil: number;
  slash: number;
  shield: number;
  crouch: number;
  hurt: number;
  telegraph: number;
}

export function createPose(): MechPose {
  return { walkPhase: 0, walkAmount: 0, airborne: false, jet: 0, aim: 0, recoil: 0, slash: -1, shield: 0, crouch: 0, hurt: 0, telegraph: 0 };
}

interface VariantSpec {
  scale: number;
  hull: string;
  armor: string;
  joint: string;
  trim: string;
  eye: string;
  digitigrade: boolean;
  cockpit: boolean;
  shoulderCannons: number;
  saber: boolean;
}

const SPECS: Record<MechVariant, VariantSpec> = {
  nitro: { scale: 1.12, hull: PALETTE.nitroHull, armor: PALETTE.nitroArmor, joint: PALETTE.joint, trim: PALETTE.trim, eye: PALETTE.glass, digitigrade: false, cockpit: true, shoulderCannons: 0, saber: true },
  trooper: { scale: 1.04, hull: PALETTE.enemyHull, armor: PALETTE.enemyArmor, joint: PALETTE.enemyDark, trim: '#e0d4ff', eye: PALETTE.enemyEye, digitigrade: true, cockpit: false, shoulderCannons: 1, saber: false },
  havoc: { scale: 1.9, hull: PALETTE.bossHull, armor: PALETTE.bossArmor, joint: '#1c1530', trim: '#ffb347', eye: '#ff2d4a', digitigrade: true, cockpit: false, shoulderCannons: 2, saber: false },
};

function box(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y, z);
  return mesh;
}

function cyl(rt: number, rb: number, h: number, mat: THREE.Material, seg = 8): THREE.Mesh {
  return new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
}

interface Limb {
  hip: THREE.Group;
  knee: THREE.Group;
  ankle: THREE.Group;
}

export class MechModel {
  readonly group = new THREE.Group();
  readonly body = new THREE.Group();
  readonly shadow: THREE.Mesh;
  readonly muzzle = new THREE.Object3D();
  readonly saberTip = new THREE.Object3D();
  readonly spec: VariantSpec;
  readonly height: number;

  private readonly pelvis = new THREE.Group();
  private readonly torso = new THREE.Group();
  private readonly nearArm = new THREE.Group();
  private readonly nearElbow = new THREE.Group();
  private readonly farArm = new THREE.Group();
  private readonly farElbow = new THREE.Group();
  private readonly legs: Limb[] = [];
  private readonly flames: THREE.Mesh[] = [];
  private readonly flashMats: THREE.MeshToonMaterial[] = [];
  private readonly eyeMat: THREE.MeshBasicMaterial;
  private readonly eyeBase: THREE.Color;
  private readonly blade: THREE.Mesh | null = null;
  private readonly shieldPanel: THREE.Mesh | null = null;
  private readonly cannons: THREE.Group[] = [];
  private readonly ownedGeometries: THREE.BufferGeometry[] = [];
  private readonly ownedMaterials: THREE.Material[] = [];
  private facing = 1;
  private flip = 1;

  constructor(readonly variant: MechVariant) {
    const s = (this.spec = SPECS[variant]);
    const tex = textures();
    const decal = variant === 'nitro' ? tex.mechDecal : tex.enemyDecal;
    const hull = toon(s.hull, { map: decal });
    const armor = toon(s.armor, { map: decal });
    const joint = toon(s.joint);
    const trim = toon(s.trim);
    const dark = toon(variant === 'nitro' ? PALETTE.jointDark : '#150f26');
    this.flashMats.push(hull, armor, joint, trim);
    this.eyeBase = new THREE.Color(s.eye).multiplyScalar(2.4);
    this.eyeMat = new THREE.MeshBasicMaterial({ color: this.eyeBase.clone() });
    const flameMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffb347').multiplyScalar(3), transparent: true, opacity: 0.9, depthWrite: false });
    this.ownedMaterials.push(hull, armor, joint, trim, dark, this.eyeMat, flameMat);

    this.group.add(this.body);
    this.body.scale.setScalar(s.scale);
    this.body.add(this.pelvis);
    this.pelvis.position.y = 1.0;

    this.pelvis.add(box(0.62, 0.3, 0.62, joint, 0, 0, 0));
    this.pelvis.add(box(0.4, 0.26, 0.7, armor, 0.12, -0.04, 0));

    this.pelvis.add(this.torso);
    this.torso.position.y = 0.14;

    if (variant === 'nitro') {
      this.torso.add(box(0.92, 0.72, 0.82, hull, -0.02, 0.42, 0));
      const plate = box(0.42, 0.56, 0.74, armor, 0.38, 0.34, 0);
      plate.rotation.z = -0.28;
      this.torso.add(plate);
      this.torso.add(box(0.94, 0.08, 0.84, trim, -0.02, 0.1, 0));
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.27, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), toon(PALETTE.glass, { emissive: '#0b5a66', emissiveIntensity: 0.9 }));
      this.ownedMaterials.push(dome.material as THREE.Material);
      dome.rotation.z = -1.0;
      dome.position.set(0.38, 0.62, 0);
      this.torso.add(dome);
      this.torso.add(box(0.28, 0.2, 0.34, joint, 0.06, 0.9, 0));
      this.torso.add(box(0.08, 0.06, 0.3, this.eyeMat, 0.21, 0.92, 0));
      this.torso.add(box(0.46, 0.66, 0.64, dark, -0.62, 0.42, 0));
      this.torso.add(box(0.34, 0.12, 0.66, trim, -0.64, 0.8, 0));
    } else {
      const chest = box(0.78, 0.6, 0.7, hull, 0, 0.4, 0);
      chest.rotation.z = 0.12;
      this.torso.add(chest);
      this.torso.add(box(0.36, 0.44, 0.6, armor, 0.34, 0.36, 0));
      const head = box(0.34, 0.22, 0.36, armor, 0.26, 0.78, 0);
      head.rotation.z = -0.2;
      this.torso.add(head);
      this.torso.add(box(0.1, 0.07, 0.38, this.eyeMat, 0.44, 0.76, 0));
      this.torso.add(box(0.34, 0.52, 0.58, dark, -0.5, 0.42, 0));
      this.torso.add(box(0.8, 0.06, 0.72, trim, 0, 0.12, 0));
    }

    for (let i = 0; i < 2; i += 1) {
      const z = i === 0 ? 0.18 : -0.18;
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.6, 6), flameMat);
      flame.rotation.z = Math.PI;
      flame.position.set(variant === 'nitro' ? -0.66 : -0.54, 0.0, z);
      flame.visible = false;
      this.torso.add(flame);
      this.flames.push(flame);
      const nozzle = cyl(0.09, 0.12, 0.16, joint, 6);
      nozzle.position.set(flame.position.x, 0.12, z);
      this.torso.add(nozzle);
    }

    for (let c = 0; c < s.shoulderCannons; c += 1) {
      const mount = new THREE.Group();
      const z = s.shoulderCannons === 1 ? -0.1 : c === 0 ? 0.28 : -0.28;
      mount.position.set(-0.2, 0.9, z);
      mount.add(box(0.34, 0.22, 0.24, joint, 0, 0, 0));
      const barrel = cyl(0.07, 0.08, 0.7, dark, 6);
      barrel.rotation.z = Math.PI / 2;
      barrel.position.set(0.4, 0.04, 0);
      mount.add(barrel);
      mount.add(box(0.08, 0.1, 0.12, this.eyeMat, 0.76, 0.04, 0));
      this.torso.add(mount);
      this.cannons.push(mount);
    }

    const shoulderW = variant === 'nitro' ? 0.52 : 0.42;
    for (const side of [1, -1]) {
      const pad = box(shoulderW, 0.36, 0.3, armor, 0.02, 0.74, side * 0.54);
      this.torso.add(pad);
      this.torso.add(box(shoulderW + 0.02, 0.06, 0.32, trim, 0.02, 0.62, side * 0.54));
    }

    this.nearArm.position.set(0.02, 0.62, 0.56);
    this.farArm.position.set(0.02, 0.62, -0.56);
    this.torso.add(this.nearArm, this.farArm);
    for (const arm of [this.nearArm, this.farArm]) {
      arm.add(box(0.2, 0.46, 0.2, joint, 0, -0.23, 0));
    }
    this.nearElbow.position.y = -0.46;
    this.farElbow.position.y = -0.46;
    this.nearArm.add(this.nearElbow);
    this.farArm.add(this.farElbow);

    // Near forearm carries the fusion rifle; it rotates to the aim angle.
    this.nearElbow.add(box(0.44, 0.26, 0.28, hull, 0.16, 0, 0));
    const rifleBody = box(0.7, 0.18, 0.16, dark, 0.52, 0.06, 0.06);
    this.nearElbow.add(rifleBody);
    this.nearElbow.add(box(0.24, 0.1, 0.1, trim, 0.4, 0.18, 0.06));
    const barrel = cyl(0.05, 0.05, 0.44, joint, 6);
    barrel.rotation.z = Math.PI / 2;
    barrel.position.set(1.06, 0.08, 0.06);
    this.nearElbow.add(barrel);
    this.muzzle.position.set(1.3, 0.08, 0.06);
    this.nearElbow.add(this.muzzle);

    this.farElbow.add(box(0.26, 0.42, 0.26, hull, 0, -0.18, 0));
    this.farElbow.add(box(0.2, 0.16, 0.2, dark, 0, -0.44, 0));
    if (s.saber) {
      const bladeMat = glow(PALETTE.saber, 3);
      this.ownedMaterials.push(bladeMat);
      const blade = box(0.09, 1.25, 0.06, bladeMat, 0, -1.12, 0);
      blade.visible = false;
      this.farElbow.add(blade);
      this.blade = blade;
      this.saberTip.position.set(0, -1.7, 0);
      this.farElbow.add(this.saberTip);
    }
    const shieldMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(variant === 'nitro' ? '#5cf2ff' : '#ff7ad1').multiplyScalar(1.6), transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide });
    this.ownedMaterials.push(shieldMat);
    const panel = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 0.06, 6), shieldMat);
    panel.rotation.z = Math.PI / 2;
    panel.position.set(0.5, -0.4, 0);
    panel.visible = false;
    this.farElbow.add(panel);
    this.shieldPanel = panel;

    for (const side of [1, -1]) {
      const hip = new THREE.Group();
      hip.position.set(0, -0.08, side * 0.28);
      this.pelvis.add(hip);
      hip.add(box(0.28, 0.52, 0.28, joint, 0, -0.26, 0));
      hip.add(box(0.34, 0.3, 0.3, armor, 0.02, -0.12, 0));
      const knee = new THREE.Group();
      knee.position.y = -0.52;
      hip.add(knee);
      knee.add(box(0.26, 0.2, 0.3, armor, 0.12, 0, 0));
      knee.add(box(0.34, 0.52, 0.34, hull, 0, -0.28, 0));
      knee.add(box(0.36, 0.06, 0.36, trim, 0, -0.08, 0));
      const ankle = new THREE.Group();
      ankle.position.y = -0.52;
      knee.add(ankle);
      ankle.add(box(0.56, 0.14, 0.38, dark, 0.1, -0.04, 0));
      ankle.add(box(0.2, 0.1, 0.4, joint, -0.2, -0.02, 0));
      this.legs.push({ hip, knee, ankle });
    }

    this.body.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (mesh.isMesh) this.ownedGeometries.push(mesh.geometry);
    });

    const shadowMat = new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.45, depthWrite: false });
    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(0.7 * s.scale, 12), shadowMat);
    this.shadow.rotation.x = -Math.PI / 2;
    this.ownedGeometries.push(this.shadow.geometry);
    this.ownedMaterials.push(shadowMat);

    this.height = 2.1 * s.scale;
  }

  setFacing(dir: number): void {
    this.facing = dir >= 0 ? 1 : -1;
  }

  update(pose: MechPose, delta: number, time: number): void {
    this.flip += (this.facing - this.flip) * Math.min(1, delta * 22);
    this.body.scale.x = this.spec.scale * (Math.abs(this.flip) < 0.2 ? Math.sign(this.flip || 1) * 0.2 : this.flip);

    const amt = pose.walkAmount;
    const p = pose.walkPhase;
    const dig = this.spec.digitigrade ? -1 : 1;
    const bob = pose.airborne ? 0 : Math.abs(Math.sin(p)) * 0.07 * amt;
    this.pelvis.position.y = 1.0 - pose.crouch * 0.28 + bob - 0.03 * amt;
    this.torso.rotation.z = -0.08 * amt - pose.telegraph * 0.25 + pose.crouch * -0.1 + (pose.airborne ? -0.06 : 0);

    for (let i = 0; i < 2; i += 1) {
      const leg = this.legs[i];
      const sign = i === 0 ? 1 : -1;
      if (pose.airborne) {
        const tuck = pose.jet > 0.1 ? 0.25 : 0;
        leg.hip.rotation.z = (i === 0 ? 0.35 : -0.25) - tuck;
        leg.knee.rotation.z = -dig * (i === 0 ? 0.7 : 0.45);
        leg.ankle.rotation.z = 0.3;
      } else {
        const swing = Math.sin(p + (sign > 0 ? 0 : Math.PI));
        leg.hip.rotation.z = swing * 0.62 * amt + pose.crouch * 0.6 + (dig < 0 ? 0.2 : 0);
        const lift = Math.max(0, -Math.cos(p + (sign > 0 ? 0 : Math.PI)));
        leg.knee.rotation.z = -dig * (lift * 0.95 * amt + pose.crouch * 1.1) + (dig < 0 ? 0.45 : 0);
        leg.ankle.rotation.z = -leg.hip.rotation.z - leg.knee.rotation.z;
      }
    }

    const aim = THREE.MathUtils.clamp(pose.aim, -1, 1);
    this.nearArm.rotation.z = 0.55 + aim * 0.5 + pose.recoil * 0.25;
    // Rifle world angle = shoulder + elbow rotation; solve the elbow so it equals the aim.
    this.nearElbow.rotation.z = aim * (Math.PI / 4) - this.nearArm.rotation.z - pose.recoil * 0.15;
    this.nearElbow.position.x = -pose.recoil * 0.05;

    if (pose.slash >= 0) {
      const t = pose.slash;
      const eased = 1 - Math.pow(1 - t, 3);
      this.farArm.rotation.z = 2.8 - eased * 3.6;
      this.farElbow.rotation.z = 0.3 - eased * 0.3;
    } else if (pose.shield > 0) {
      this.farArm.rotation.z = THREE.MathUtils.lerp(0.2, 1.5, pose.shield);
      this.farElbow.rotation.z = THREE.MathUtils.lerp(0.4, 0.1, pose.shield);
    } else {
      const sway = Math.sin(p + Math.PI) * 0.3 * amt;
      this.farArm.rotation.z = 0.25 + sway + (pose.airborne ? 0.4 : 0);
      this.farElbow.rotation.z = 0.5;
    }
    if (this.blade) this.blade.visible = pose.slash >= 0 && pose.slash < 0.92;
    if (this.shieldPanel) {
      this.shieldPanel.visible = pose.shield > 0.05;
      this.shieldPanel.scale.setScalar(0.6 + pose.shield * 0.4 + Math.sin(time * 30) * 0.02);
    }

    for (const cannon of this.cannons) cannon.rotation.z = aim * 0.4 + pose.telegraph * 0.15;

    const jetOn = pose.jet > 0.05;
    for (let i = 0; i < this.flames.length; i += 1) {
      const flame = this.flames[i];
      flame.visible = jetOn;
      if (jetOn) {
        const flicker = 0.75 + 0.25 * Math.sin(time * 60 + i * 2.1);
        flame.scale.set(1, pose.jet * flicker * 1.4, 1);
        flame.position.y = -0.2 * pose.jet * flicker;
      }
    }

    // Squared falloff keeps rapid-fire hits as short pops instead of a constant white-out.
    const hurt = pose.hurt * pose.hurt;
    for (const mat of this.flashMats) {
      mat.emissive.setRGB(hurt, hurt, hurt);
      mat.emissiveIntensity = hurt * 1.4;
    }
    this.eyeMat.color.copy(this.eyeBase).multiplyScalar(1 + pose.telegraph * 2.5);
  }

  dispose(): void {
    for (const g of this.ownedGeometries) g.dispose();
    for (const m of this.ownedMaterials) m.dispose();
  }
}
