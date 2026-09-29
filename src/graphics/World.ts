import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Level, Tile } from '../levels/Level';
import { createSeededRandom } from '../utils/random';
import { glow, PALETTE, textures, toon } from './materials';
import { createCapitalShip, createPlanet } from './Props';

// Level geometry stays behind the gameplay plane (z = 0) so mechs always read in
// front of walls and floors like sprites, even when their model overhangs a hitbox.
const TILE_BACK = -2.2;
const TILE_FRONT = -0.75;
const TILE_DEPTH = TILE_FRONT - TILE_BACK;
const TILE_Z = (TILE_FRONT + TILE_BACK) / 2;

function tileGeometry(depth: number): THREE.BoxGeometry {
  const geo = new THREE.BoxGeometry(1, 1, depth);
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  // Faces 0/1 (+x/-x) span z along u; faces 2/3 (+y/-y) span z along v.
  for (let face = 0; face < 4; face += 1) {
    for (let v = 0; v < 4; v += 1) {
      const i = face * 4 + v;
      if (face < 2) uv.setX(i, uv.getX(i) * depth);
      else uv.setY(i, uv.getY(i) * depth);
    }
  }
  uv.needsUpdate = true;
  return geo;
}

export class World {
  readonly group = new THREE.Group();
  readonly gate = new THREE.Group();
  private readonly electricTex: THREE.Texture;
  private readonly blinkers: THREE.MeshBasicMaterial[] = [];
  private readonly fans: THREE.Object3D[] = [];
  private readonly ship: THREE.Group;
  private readonly planet: THREE.Group;
  private readonly spaceLayer = new THREE.Group();
  private readonly gateMat: THREE.MeshBasicMaterial;
  private furnaceMat: THREE.MeshBasicMaterial | null = null;
  private coolantMat: THREE.MeshBasicMaterial | null = null;
  private electricGlow: THREE.MeshBasicMaterial | null = null;
  private readonly glowPool = new Map<string, THREE.MeshBasicMaterial>();
  private blinkSlot = 0;

  constructor(private readonly level: Level) {
    const tex = textures();
    this.electricTex = tex.electric;
    this.buildTiles();
    this.buildCatwalkRails();
    this.buildBackWall();
    this.buildMidProps();
    this.buildSectionDressing();
    this.buildElectricGlow();
    this.mergeStatic();

    this.gateMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff3a5c').multiplyScalar(2.2), transparent: true, opacity: 0.8, depthWrite: false });
    for (let i = 0; i < 5; i += 1) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.12, 14, 0.12), this.gateMat);
      bar.position.set(level.gateX + 0.5, 9, -1.2 + i * 0.6);
      this.gate.add(bar);
    }
    const frameMat = toon(PALETTE.steelDark, { map: tex.steel });
    this.gate.add(new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.6, 3.4), frameMat).translateX(level.gateX + 0.5).translateY(15.7));
    this.gate.add(new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.6, 3.4), frameMat).translateX(level.gateX + 0.5).translateY(2.3));
    this.gate.visible = false;
    this.group.add(this.gate);

    this.planet = createPlanet(16);
    this.planet.position.set(40, -6, -90);
    this.spaceLayer.add(this.planet);
    this.ship = createCapitalShip();
    this.ship.scale.setScalar(1.8);
    this.ship.position.set(60, 18, -70);
    this.spaceLayer.add(this.ship);
    this.buildStars();
    this.group.add(this.spaceLayer);
  }

  /** Shared emissive materials; blinking ones rotate through 3 phase slots so they can be merged. */
  private pooledGlow(hex: string, intensity: number, blinking: boolean): THREE.MeshBasicMaterial {
    const key = `${hex}|${intensity}|${blinking ? this.blinkSlot++ % 3 : 'on'}`;
    let mat = this.glowPool.get(key);
    if (!mat) {
      mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(intensity) });
      this.glowPool.set(key, mat);
      if (blinking) this.blinkers.push(mat);
    }
    return mat;
  }

  /** Bake every static single-material mesh into one mesh per material to cut draw calls. */
  private mergeStatic(): void {
    this.group.updateMatrixWorld(true);
    const animated = new Set<THREE.Object3D>();
    for (const fan of this.fans) fan.traverse((o) => animated.add(o));
    const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
    const merged: THREE.Mesh[] = [];
    this.group.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh || (mesh as THREE.InstancedMesh).isInstancedMesh || animated.has(mesh)) return;
      if (Array.isArray(mesh.material)) return;
      const geo = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
      for (const name of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(name)) geo.deleteAttribute(name);
      geo.applyMatrix4(mesh.matrixWorld);
      const list = buckets.get(mesh.material) ?? [];
      list.push(geo);
      buckets.set(mesh.material, list);
      merged.push(mesh);
    });
    for (const mesh of merged) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
    }
    for (const [material, geos] of buckets) {
      const geometry = mergeGeometries(geos, false);
      for (const g of geos) g.dispose();
      if (!geometry) continue;
      this.group.add(new THREE.Mesh(geometry, material));
    }
  }

  setGate(closed: boolean): void {
    this.gate.visible = closed;
  }

  /** Space layer follows the camera partially so it reads as a very distant parallax plane. */
  update(time: number, cameraX: number): void {
    this.electricTex.offset.x = Math.floor(time * 12) / 16;
    this.electricTex.offset.y = (Math.floor(time * 20) % 4) / 16;
    this.spaceLayer.position.x = cameraX * 0.72;
    this.ship.position.x = 30 + ((time * 1.2) % 140) - 40;
    this.ship.position.y = 17 + Math.sin(time * 0.3) * 0.6;
    const planetMesh = this.planet.getObjectByName('planet');
    if (planetMesh) planetMesh.rotation.y = time * 0.02;
    for (let i = 0; i < this.blinkers.length; i += 1) {
      const on = Math.sin(time * (2 + (i % 3)) + i * 1.7) > 0.2;
      this.blinkers[i].visible = on;
    }
    for (const fan of this.fans) fan.rotation.z = time * 4;
    this.gateMat.opacity = 0.55 + 0.35 * Math.abs(Math.sin(time * 9));
    if (this.furnaceMat) this.furnaceMat.color.setScalar(1.5 + Math.sin(time * 3) * 0.25 + Math.sin(time * 7.3) * 0.1);
    if (this.coolantMat) this.coolantMat.color.set('#4dffe0').multiplyScalar(1.5 + Math.sin(time * 2) * 0.4);
    if (this.electricGlow) this.electricGlow.opacity = 0.14 + (Math.floor(time * 18) % 3) * 0.08;
  }

  private buildTiles(): void {
    const tex = textures();
    const level = this.level;
    const geo = tileGeometry(TILE_DEPTH);
    const steelSide = toon('#8d9cc4', { map: tex.steel });
    const steelTop = toon('#8d9cc4', { map: tex.steelTop });
    const rust = toon('#ffffff', { map: tex.rust });
    const hazard = toon('#ffffff', { map: tex.hazard });
    const crate = toon('#ffffff', { map: tex.crate });
    const electric = new THREE.MeshBasicMaterial({ map: tex.electric, color: new THREE.Color('#9fdcff').multiplyScalar(1.15) });

    const materialSets: Partial<Record<Tile, THREE.Material | THREE.Material[]>> = {
      [Tile.Steel]: [steelSide, steelSide, steelTop, steelSide, steelSide, steelSide],
      [Tile.Rust]: rust,
      [Tile.Hazard]: [hazard, hazard, steelTop, hazard, hazard, hazard],
      [Tile.Crate]: crate,
      [Tile.Electric]: electric,
    };

    const positions = new Map<Tile, Array<[number, number]>>();
    for (let y = 0; y < level.height; y += 1) {
      for (let x = 0; x < level.width; x += 1) {
        const t = level.get(x, y);
        if (t === Tile.Empty || t === Tile.Catwalk || t === Tile.Gate) continue;
        // Skip fully enclosed tiles in the thick outer walls; they are never visible.
        const enclosed =
          level.get(x - 1, y) !== Tile.Empty && level.get(x + 1, y) !== Tile.Empty &&
          level.get(x, y - 1) !== Tile.Empty && level.get(x, y + 1) !== Tile.Empty &&
          (x <= 0 || x >= level.width - 1 || y <= 0 || y >= level.height - 1);
        if (enclosed) continue;
        if (!positions.has(t)) positions.set(t, []);
        positions.get(t)!.push([x, y]);
      }
    }
    // Visual-only fill outside the collision grid so the camera never sees past the hull.
    const fill = positions.get(Tile.Steel) ?? [];
    for (let y = -4; y < level.height + 4; y += 1) {
      for (let x = -5; x < level.width + 5; x += 1) {
        if (y < 0 || y >= level.height || x < 0 || x >= level.width) fill.push([x, y]);
      }
    }
    positions.set(Tile.Steel, fill);

    const matrix = new THREE.Matrix4();
    const color = new THREE.Color();
    const rnd = createSeededRandom(77);
    for (const [tile, list] of positions) {
      const material = materialSets[tile];
      if (!material) continue;
      const mesh = new THREE.InstancedMesh(geo, material, list.length);
      list.forEach(([x, y], i) => {
        matrix.makeTranslation(x + 0.5, y + 0.5, TILE_Z);
        mesh.setMatrixAt(i, matrix);
        const shade = 0.86 + rnd() * 0.14;
        mesh.setColorAt(i, color.setRGB(shade, shade, shade * 1.02));
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.frustumCulled = false;
      this.group.add(mesh);
    }

    const catwalks: Array<[number, number]> = [];
    for (let y = 0; y < level.height; y += 1) for (let x = 0; x < level.width; x += 1) if (level.get(x, y) === Tile.Catwalk) catwalks.push([x, y]);
    const walkGeo = tileGeometry(TILE_DEPTH);
    walkGeo.scale(1, 0.3, 1);
    const grate = toon('#ffffff', { map: tex.grate });
    const walkTop = toon('#c96a36');
    const walks = new THREE.InstancedMesh(walkGeo, [grate, grate, walkTop, walkTop, grate, grate], catwalks.length);
    catwalks.forEach(([x, y], i) => {
      matrix.makeTranslation(x + 0.5, y + 0.85, TILE_Z);
      walks.setMatrixAt(i, matrix);
    });
    walks.instanceMatrix.needsUpdate = true;
    walks.frustumCulled = false;
    this.group.add(walks);
  }

  private buildCatwalkRails(): void {
    const level = this.level;
    const postGeo = new THREE.BoxGeometry(0.08, 0.8, 0.08);
    const mat = toon(PALETTE.hazard);
    const posts: THREE.Vector3[] = [];
    for (let y = 0; y < level.height; y += 1) {
      for (let x = 0; x < level.width; x += 1) {
        if (level.get(x, y) !== Tile.Catwalk) continue;
        posts.push(new THREE.Vector3(x + 0.1, y + 1.4, -1.2));
        if (level.get(x + 1, y) !== Tile.Catwalk) posts.push(new THREE.Vector3(x + 0.9, y + 1.4, -1.2));
      }
    }
    const inst = new THREE.InstancedMesh(postGeo, mat, posts.length);
    const m = new THREE.Matrix4();
    posts.forEach((p, i) => {
      m.makeTranslation(p.x, p.y, p.z);
      inst.setMatrixAt(i, m);
    });
    inst.instanceMatrix.needsUpdate = true;
    inst.frustumCulled = false;
    this.group.add(inst);

    // Top rail bars per catwalk run.
    const barMat = toon(PALETTE.rust);
    for (let y = 0; y < level.height; y += 1) {
      let runStart = -1;
      for (let x = 0; x <= level.width; x += 1) {
        const isWalk = x < level.width && level.get(x, y) === Tile.Catwalk;
        if (isWalk && runStart < 0) runStart = x;
        if (!isWalk && runStart >= 0) {
          const len = x - runStart;
          const bar = new THREE.Mesh(new THREE.BoxGeometry(len, 0.08, 0.08), barMat);
          bar.position.set(runStart + len / 2, y + 1.8, -1.2);
          this.group.add(bar);
          runStart = -1;
        }
      }
    }
  }

  private buildBackWall(): void {
    const tex = textures();
    const level = this.level;
    const bottom = -6;
    const top = level.height + 6;
    const wallPiece = (x0: number, x1: number, y0: number, y1: number, tint: string, source: THREE.Texture, unit: number) => {
      const w = x1 - x0;
      const h = y1 - y0;
      const map = source.clone();
      map.needsUpdate = true;
      map.repeat.set(w / unit, h / unit);
      map.offset.set(x0 / unit, y0 / unit);
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshLambertMaterial({ map, alphaTest: 0.5, color: tint }));
      mesh.position.set(x0 + w / 2, y0 + h / 2, -2.2);
      this.group.add(mesh);
    };
    const sections: Array<[number, number, string]> = [
      [-6, 43, '#8098f0'],
      [43, 89, '#e89a70'],
      [89, 133, '#6ed4c4'],
      [133, level.width + 6, '#c07cc8'],
    ];
    for (const [x0, x1, tint] of sections) {
      if (x0 < 22 && x1 > 4) {
        // Hangar: panoramic observation windows onto the planet and fleet.
        wallPiece(x0, 4, bottom, top, tint, tex.wall, 4);
        wallPiece(4, 22, bottom, 2.6, tint, tex.wall, 4);
        wallPiece(4, 22, 2.6, 11.6, '#c8d4f8', tex.wallPanorama, 9);
        wallPiece(4, 22, 11.6, top, tint, tex.wall, 4);
        wallPiece(22, x1, bottom, top, tint, tex.wall, 4);
      } else {
        wallPiece(x0, x1, bottom, top, tint, tex.wall, 4);
      }
    }

    // Girder lattice behind the windows for parallax depth.
    const girderMat = toon('#2c3558');
    const girders = new THREE.Group();
    for (let x = 0; x < level.width; x += 6) {
      const v = new THREE.Mesh(new THREE.BoxGeometry(0.5, 20, 0.5), girderMat);
      v.position.set(x, 9, -7);
      girders.add(v);
      const d = new THREE.Mesh(new THREE.BoxGeometry(0.25, 8.5, 0.25), girderMat);
      d.rotation.z = 0.78;
      d.position.set(x + 3, 9 + ((x / 6) % 2 === 0 ? 2 : -2), -7);
      girders.add(d);
    }
    const h = new THREE.Mesh(new THREE.BoxGeometry(level.width, 0.4, 0.4), girderMat);
    h.position.set(level.width / 2, 12.6, -7);
    girders.add(h);
    const h2 = h.clone();
    h2.position.y = 5.4;
    girders.add(h2);
    this.group.add(girders);
  }

  private buildMidProps(): void {
    const tex = textures();
    const level = this.level;
    const rnd = createSeededRandom(5);
    const steel = toon('#7d8bb3', { map: tex.steel });
    const dark = toon(PALETTE.steelDeep);
    const rust = toon('#ffffff', { map: tex.rust });
    const hazard = toon('#ffffff', { map: tex.hazard });
    const tankMat = toon('#9aa6c8');
    const pipeMat = toon('#5b6a96');
    const screenColors = ['#3fe0ff', '#7dff6a', '#ff5a3c', '#ffb347'];
    const crateMat = toon('#ffffff', { map: tex.crate });

    const floorTop = (x: number) => level.groundBelow(x + 0.5, 15);

    for (let x = 4; x < level.width - 4; x += 5 + Math.floor(rnd() * 4)) {
      const base = floorTop(x);
      if (base > 9) continue;
      const pick = rnd();
      const z = -1.75;
      if (pick < 0.22) {
        const tank = new THREE.Group();
        const body = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 2.6, 10), tankMat);
        body.position.y = 1.5;
        tank.add(body);
        tank.add(new THREE.Mesh(new THREE.CylinderGeometry(0.84, 0.84, 0.18, 10), hazard).translateY(0.4));
        tank.add(new THREE.Mesh(new THREE.SphereGeometry(0.8, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2), tankMat).translateY(2.8));
        const lamp = this.pooledGlow(screenColors[Math.floor(rnd() * 4)], 2.2, true);
        tank.add(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), lamp).translateY(2.1).translateZ(0.8));
        tank.position.set(x + 0.5, base, z);
        this.group.add(tank);
      } else if (pick < 0.44) {
        const console = new THREE.Group();
        console.add(new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.1, 0.7), steel).translateY(0.55));
        const screenMat = this.pooledGlow(screenColors[Math.floor(rnd() * 4)], 1.6, false);
        console.add(new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.5, 0.05), screenMat).translateY(0.75).translateZ(0.36));
        for (let i = 0; i < 3; i += 1) {
          const blink = this.pooledGlow(screenColors[i], 2.4, true);
          console.add(new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.05), blink).translateX(-0.4 + i * 0.4).translateY(0.28).translateZ(0.36));
        }
        console.position.set(x + 0.5, base, z);
        this.group.add(console);
      } else if (pick < 0.62) {
        const fanFrame = new THREE.Group();
        fanFrame.add(new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.2, 0.3), dark));
        const rotor = new THREE.Group();
        for (let i = 0; i < 4; i += 1) {
          const blade = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.9, 0.06), pipeMat);
          blade.position.y = 0.45;
          const arm = new THREE.Group();
          arm.rotation.z = (i * Math.PI) / 2;
          arm.add(blade);
          rotor.add(arm);
        }
        rotor.position.z = 0.18;
        fanFrame.add(rotor);
        this.fans.push(rotor);
        fanFrame.position.set(x + 0.5, base + 3.4, -2.0);
        this.group.add(fanFrame);
      } else if (pick < 0.8) {
        const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 16 - base, 8), pipeMat);
        pipe.position.set(x + 0.5, base + (16 - base) / 2, -1.9);
        this.group.add(pipe);
        for (let yy = base + 1.5; yy < 15; yy += 3.5) {
          this.group.add(new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.2, 8), rust).translateX(x + 0.5).translateY(yy).translateZ(-1.9));
        }
      } else {
        const crates = new THREE.Group();
        const c1 = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), crateMat);
        c1.position.y = 0.5;
        crates.add(c1);
        const c2 = c1.clone();
        c2.position.set(1.05, 0.5, 0.1);
        crates.add(c2);
        const c3 = c1.clone();
        c3.position.set(0.5, 1.5, 0);
        crates.add(c3);
        crates.position.set(x, base, z);
        this.group.add(crates);
      }
    }

    // Warning light strips along the ceiling.
    for (let x = 6; x < level.width - 4; x += 8) {
      const lamp = this.pooledGlow(x % 16 === 6 ? '#ff5a3c' : '#ffb347', 2.6, true);
      let ceiling = 16;
      for (let y = 15; y > 2; y -= 1) if (level.isSolid(level.get(x, y))) ceiling = y;
      const housing = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.25, 0.6), dark);
      housing.position.set(x + 0.5, ceiling - 0.12, -1.4);
      this.group.add(housing);
      this.group.add(new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.14, 0.36), lamp).translateX(x + 0.5).translateY(ceiling - 0.3).translateZ(-1.4));
    }

    // Hanging chains/cables.
    const cableMat = toon('#1a1f33');
    for (let x = 10; x < level.width - 6; x += 13) {
      let ceiling = 16;
      for (let y = 15; y > 2; y -= 1) if (level.isSolid(level.get(x, y))) ceiling = y;
      const len = 2 + rnd() * 3;
      const cable = new THREE.Mesh(new THREE.BoxGeometry(0.08, len, 0.08), cableMat);
      cable.position.set(x + 0.3, ceiling - len / 2, -1.0);
      this.group.add(cable);
      const hook = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.2), hazard);
      hook.position.set(x + 0.3, ceiling - len, -1.0);
      this.group.add(hook);
    }
  }

  private buildSectionDressing(): void {
    const tex = textures();
    const level = this.level;

    // Wall-mounted support columns shared by every section.
    const columnTex = tex.column.clone();
    columnTex.needsUpdate = true;
    columnTex.repeat.set(1, 15);
    const columnMat = toon('#9aa8d0', { map: columnTex });
    const columnXs: number[] = [];
    for (let x = 6; x < level.width - 2; x += 9) columnXs.push(x);
    const columns = new THREE.InstancedMesh(new THREE.BoxGeometry(0.9, 30, 0.5), columnMat, columnXs.length);
    const m = new THREE.Matrix4();
    columnXs.forEach((x, i) => {
      m.makeTranslation(x, 9, -2.0);
      columns.setMatrixAt(i, m);
    });
    columns.instanceMatrix.needsUpdate = true;
    columns.frustumCulled = false;
    this.group.add(columns);

    // Hazard dado strip along the floor line.
    const dadoTex = tex.hazard.clone();
    dadoTex.needsUpdate = true;
    dadoTex.repeat.set(level.width * 1.5, 1);
    const dado = new THREE.Mesh(new THREE.BoxGeometry(level.width, 0.5, 0.15), toon('#ffffff', { map: dadoTex }));
    dado.position.set(level.width / 2, 2.25, -2.1);
    this.group.add(dado);

    // Foundry furnaces: glowing grilles on the warm wall.
    const furnaceMat = new THREE.MeshBasicMaterial({ map: tex.furnace, color: new THREE.Color('#ffffff').multiplyScalar(1.7) });
    this.furnaceMat = furnaceMat;
    const furnaceFrameMat = toon(PALETTE.rustDark);
    const hoodMat = toon('#ffffff', { map: tex.hazard });
    for (let x = 47; x < 88; x += 10) {
      const frame = new THREE.Mesh(new THREE.BoxGeometry(3.2, 3.2, 0.3), furnaceFrameMat);
      frame.position.set(x, 5.4, -2.12);
      this.group.add(frame);
      const grille = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 2.8), furnaceMat);
      grille.position.set(x, 5.4, -1.95);
      this.group.add(grille);
      const hood = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.5, 0.9), hoodMat);
      hood.position.set(x, 7.2, -1.9);
      this.group.add(hood);
    }

    // Reactor coolant tubes: vertical teal glow lines.
    const tubeGlow = glow('#4dffe0', 1.8);
    this.coolantMat = tubeGlow;
    const tubeShell = new THREE.MeshLambertMaterial({ color: '#8fd8e0', transparent: true, opacity: 0.35, depthWrite: false });
    const panelMat = toon('#ffffff', { map: tex.reactorPanel });
    for (let x = 91; x < 132; x += 7) {
      const core = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 14, 6), tubeGlow);
      core.position.set(x, 9, -1.95);
      this.group.add(core);
      const shell = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 14, 8), tubeShell);
      shell.position.copy(core.position);
      this.group.add(shell);
      const panel = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.2, 0.2), panelMat);
      panel.position.set(x + 3.2, 10.5, -2.08);
      this.group.add(panel);
    }

    // Guardian arena: red emergency panels and a heavy blast frame.
    const alarm = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff2d4a').multiplyScalar(2) });
    this.blinkers.push(alarm);
    const frameMat = toon('#ffffff', { map: tex.hazard });
    for (const x of [137, 150, 163]) {
      this.group.add(new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.2), alarm).translateX(x).translateY(13).translateZ(-1.9));
    }
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(level.arenaMaxX - level.gateX, 0.8, 0.4), frameMat);
    lintel.position.set((level.arenaMaxX + level.gateX) / 2, 14.6, -1.9);
    this.group.add(lintel);
  }

  private buildElectricGlow(): void {
    const level = this.level;
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#3fd8ff'), transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    this.electricGlow = mat;
    const postMat = toon('#ffffff', { map: textures().hazard });
    let start = -1;
    for (let x = 0; x <= level.width; x += 1) {
      const isElectric = x < level.width && level.get(x, 0) === Tile.Electric;
      if (isElectric && start < 0) start = x;
      if (!isElectric && start >= 0) {
        const len = x - start;
        const curtain = new THREE.Mesh(new THREE.PlaneGeometry(len, 0.9), mat);
        curtain.position.set(start + len / 2, 1.3, TILE_FRONT + 0.02);
        this.group.add(curtain);
        for (const side of [start, x]) {
          const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.2, TILE_DEPTH), postMat);
          post.position.set(side, 1.6, TILE_Z);
          this.group.add(post);
        }
        start = -1;
      }
    }
  }

  private buildStars(): void {
    const rnd = createSeededRandom(99);
    const count = 700;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      positions[i * 3] = -60 + rnd() * 260;
      positions[i * 3 + 1] = -30 + rnd() * 70;
      positions[i * 3 + 2] = -120 + rnd() * 20;
      const b = 0.6 + rnd() * 1.8;
      const tint = rnd();
      colors[i * 3] = b * (tint > 0.8 ? 1 : 0.8);
      colors[i * 3 + 1] = b * 0.9;
      colors[i * 3 + 2] = b * (tint < 0.3 ? 1.3 : 1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const stars = new THREE.Points(geo, new THREE.PointsMaterial({ size: 1.4, sizeAttenuation: false, vertexColors: true }));
    stars.frustumCulled = false;
    this.spaceLayer.add(stars);
  }
}
