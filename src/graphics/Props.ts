import * as THREE from 'three';
import { glow, PALETTE, textures, toon } from './materials';

function box(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y, z);
  return mesh;
}

export class DroneModel {
  readonly group = new THREE.Group();
  readonly eye: THREE.Mesh;
  private readonly eyeMat: THREE.MeshBasicMaterial;
  private readonly hullMats: THREE.MeshToonMaterial[];
  private readonly finL: THREE.Mesh;
  private readonly finR: THREE.Mesh;
  private readonly thruster: THREE.Mesh;

  constructor() {
    const hull = toon(PALETTE.enemyHull, { map: textures().enemyDecal });
    const armor = toon(PALETTE.enemyArmor);
    const dark = toon(PALETTE.enemyDark);
    this.hullMats = [hull, armor, dark];
    this.eyeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.enemyEye).multiplyScalar(2) });
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.42, 8, 6), hull);
    this.group.add(body);
    this.group.add(box(0.5, 0.2, 0.6, armor, -0.05, -0.3, 0));
    this.group.add(box(0.2, 0.34, 0.3, dark, -0.42, 0.02, 0));
    this.eye = new THREE.Mesh(new THREE.SphereGeometry(0.15, 6, 4), this.eyeMat);
    this.eye.position.set(0.34, 0.04, 0);
    this.group.add(this.eye);
    this.group.add(box(0.1, 0.36, 0.38, dark, 0.3, 0.04, 0));
    this.finL = box(0.5, 0.06, 0.34, armor, -0.1, 0.12, 0.46);
    this.finR = box(0.5, 0.06, 0.34, armor, -0.1, 0.12, -0.46);
    this.group.add(this.finL, this.finR);
    this.thruster = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.45, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color('#c28bff').multiplyScalar(2.5), transparent: true, opacity: 0.85, depthWrite: false }));
    this.thruster.rotation.z = Math.PI / 2;
    this.thruster.position.set(-0.7, 0.02, 0);
    this.group.add(this.thruster);
  }

  update(time: number, telegraph: number, hurt: number, facing: number): void {
    this.group.scale.x = facing;
    this.finL.rotation.x = Math.sin(time * 14) * 0.25;
    this.finR.rotation.x = -Math.sin(time * 14) * 0.25;
    this.thruster.scale.y = 0.8 + Math.sin(time * 40) * 0.2;
    this.eye.scale.setScalar(1 + telegraph * 0.8);
    this.eyeMat.color.set(PALETTE.enemyEye).multiplyScalar(2 + telegraph * 4);
    for (const m of this.hullMats) {
      m.emissive.setRGB(hurt, hurt, hurt);
      m.emissiveIntensity = hurt * 1.6;
    }
  }

  dispose(): void {
    this.group.traverse((c) => {
      const mesh = c as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      }
    });
  }
}

export class TurretModel {
  readonly group = new THREE.Group();
  readonly pivot = new THREE.Group();
  readonly muzzle = new THREE.Object3D();
  private readonly eyeMat: THREE.MeshBasicMaterial;
  private readonly hullMats: THREE.MeshToonMaterial[];

  /** mount: 'floor' | 'ceiling' | 'wall-left' | 'wall-right' */
  constructor(mount: 'floor' | 'ceiling' | 'wall-left' | 'wall-right') {
    const base = toon(PALETTE.steelDark, { map: textures().steel });
    const hull = toon(PALETTE.enemyHull);
    const dark = toon('#141026');
    this.hullMats = [hull, base];
    this.eyeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.enemyEye).multiplyScalar(2) });
    const mountGroup = new THREE.Group();
    mountGroup.add(box(1.0, 0.3, 0.9, base, 0, 0.15, 0));
    mountGroup.add(box(1.04, 0.08, 0.94, toon(PALETTE.hazard), 0, 0.32, 0));
    this.pivot.position.y = 0.55;
    mountGroup.add(this.pivot);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.36, 8, 6), hull);
    this.pivot.add(dome);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.8, 6), dark);
    barrel.rotation.z = -Math.PI / 2;
    barrel.position.x = 0.5;
    this.pivot.add(barrel);
    const eye = box(0.1, 0.12, 0.3, this.eyeMat, 0.3, 0.12, 0);
    this.pivot.add(eye);
    this.muzzle.position.x = 0.95;
    this.pivot.add(this.muzzle);
    if (mount === 'ceiling') mountGroup.rotation.z = Math.PI;
    if (mount === 'wall-left') mountGroup.rotation.z = -Math.PI / 2;
    if (mount === 'wall-right') mountGroup.rotation.z = Math.PI / 2;
    this.group.add(mountGroup);
  }

  aimAt(worldAngle: number): void {
    const parent = this.pivot.parent;
    const parentAngle = parent ? parent.rotation.z : 0;
    this.pivot.rotation.z = worldAngle - parentAngle;
  }

  update(telegraph: number, hurt: number): void {
    this.eyeMat.color.set(PALETTE.enemyEye).multiplyScalar(2 + telegraph * 5);
    for (const m of this.hullMats) {
      m.emissive.setRGB(hurt, hurt, hurt);
      m.emissiveIntensity = hurt * 1.6;
    }
  }
}

export type PickupKind = 'repair' | 'spread' | 'life';

export function createPickupModel(kind: PickupKind): THREE.Group {
  const group = new THREE.Group();
  if (kind === 'repair') {
    group.add(new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.6, 8), toon('#2a6b4a')));
    group.add(box(0.12, 0.44, 0.62, glow(PALETTE.energy, 2.4), 0, 0, 0));
    group.add(box(0.44, 0.12, 0.62, glow(PALETTE.energy, 2.4), 0, 0, 0));
    group.add(box(0.62, 0.08, 0.62, toon(PALETTE.trim), 0, 0.32, 0));
    group.add(box(0.62, 0.08, 0.62, toon(PALETTE.trim), 0, -0.32, 0));
  } else if (kind === 'spread') {
    const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.34, 0), glow('#ff9b3d', 2.6));
    group.add(core);
    for (let i = -1; i <= 1; i += 1) {
      const bar = box(0.42, 0.07, 0.07, glow('#fff1a8', 2.4), 0.38, 0, 0);
      const pivot = new THREE.Group();
      pivot.rotation.z = i * 0.45;
      pivot.add(bar);
      group.add(pivot);
    }
  } else {
    group.add(new THREE.Mesh(new THREE.OctahedronGeometry(0.36, 0), toon(PALETTE.nitroHull, { emissive: '#ff4020', emissiveIntensity: 0.5 })));
    group.add(box(0.5, 0.1, 0.5, toon(PALETTE.trim), 0, 0, 0));
  }
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.035, 4, 16), glow(kind === 'repair' ? PALETTE.energy : kind === 'spread' ? '#ffb347' : '#ff5a3c', 1.8));
  ring.name = 'ring';
  group.add(ring);
  return group;
}

export class CheckpointBeacon {
  readonly group = new THREE.Group();
  private readonly lamp: THREE.MeshBasicMaterial;
  private readonly beam: THREE.Mesh;
  active = false;

  constructor() {
    const steel = toon(PALETTE.steelDark, { map: textures().steel });
    this.group.add(box(0.7, 0.3, 0.7, steel, 0, 0.15, 0));
    this.group.add(box(0.22, 2.2, 0.22, steel, 0, 1.3, 0));
    this.group.add(box(0.4, 0.1, 0.4, toon(PALETTE.hazard), 0, 2.2, 0));
    this.lamp = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff3040').multiplyScalar(2.2) });
    this.group.add(new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), this.lamp).translateY(2.45));
    this.beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 0.5, 3, 8, 1, true),
      new THREE.MeshBasicMaterial({ color: new THREE.Color('#5cff9d').multiplyScalar(1.2), transparent: true, opacity: 0.25, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.beam.position.y = 1.5;
    this.beam.visible = false;
    this.group.add(this.beam);
  }

  activate(): void {
    this.active = true;
    this.lamp.color.set('#5cff9d').multiplyScalar(2.4);
    this.beam.visible = true;
  }

  reset(): void {
    this.active = false;
    this.lamp.color.set('#ff3040').multiplyScalar(2.2);
    this.beam.visible = false;
  }

  update(time: number): void {
    const pulse = 0.5 + 0.5 * Math.sin(time * (this.active ? 3 : 8));
    if (!this.active) this.lamp.color.set('#ff3040').multiplyScalar(1.2 + pulse * 1.5);
    else (this.beam.material as THREE.MeshBasicMaterial).opacity = 0.12 + pulse * 0.15;
  }
}

export function createCapitalShip(): THREE.Group {
  const tex = textures();
  const hull = toon('#8a99bd', { map: tex.shipHull });
  const dark = toon('#3a4566');
  const ship = new THREE.Group();
  ship.add(box(9, 1.2, 1.6, hull, 0, 0, 0));
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.9, 3, 4), hull);
  nose.rotation.z = -Math.PI / 2;
  nose.position.x = 6;
  ship.add(nose);
  ship.add(box(4, 0.7, 1.2, hull, -1.5, 0.9, 0));
  ship.add(box(1.4, 0.8, 0.8, dark, 0.8, 1.4, 0));
  ship.add(box(3, 0.3, 5, hull, -2.5, -0.2, 0));
  for (const z of [-2.2, 2.2]) {
    ship.add(box(2.4, 0.6, 0.6, dark, -3, -0.2, z));
    const engine = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.2, 8), glow('#6fd6ff', 3));
    engine.rotation.z = Math.PI / 2;
    engine.position.set(-4.3, -0.2, z);
    ship.add(engine);
  }
  for (const y of [-0.3, 0.3]) {
    const engine = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.2, 8), glow('#6fd6ff', 3));
    engine.rotation.z = Math.PI / 2;
    engine.position.set(-4.6, y, 0);
    ship.add(engine);
  }
  return ship;
}

export function createPlanet(radius: number): THREE.Group {
  const group = new THREE.Group();
  const planet = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 32, 16),
    new THREE.MeshLambertMaterial({ map: textures().planet, emissive: '#0a1a33', emissiveIntensity: 0.4 }),
  );
  planet.name = 'planet';
  group.add(planet);
  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 1.05, 32, 16),
    new THREE.MeshBasicMaterial({ color: new THREE.Color('#6fc7ff').multiplyScalar(0.8), transparent: true, opacity: 0.22, side: THREE.BackSide, depthWrite: false }),
  );
  group.add(atmosphere);
  return group;
}
