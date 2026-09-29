import * as THREE from 'three';

const particleVertex = /* glsl */ `
attribute float size;
attribute vec3 color;
attribute float alpha;
varying vec3 vColor;
varying float vAlpha;
uniform float pixelScale;
void main() {
  vColor = color;
  vAlpha = alpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = max(1.0, floor(size * pixelScale / -mv.z));
}
`;

const particleFragment = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
uniform float round;
void main() {
  vec2 p = gl_PointCoord - 0.5;
  if (round > 0.5 && dot(p, p) > 0.25) discard;
  if (vAlpha <= 0.01) discard;
  gl_FragColor = vec4(vColor, vAlpha);
}
`;

class ParticlePool {
  readonly points: THREE.Points;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly col: Float32Array;
  private readonly baseCol: Float32Array;
  private readonly size: Float32Array;
  private readonly baseSize: Float32Array;
  private readonly alpha: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly gravity: Float32Array;
  private readonly drag: Float32Array;
  private readonly shrink: Uint8Array;
  private cursor = 0;
  private readonly geometry: THREE.BufferGeometry;
  readonly material: THREE.ShaderMaterial;

  constructor(private readonly max: number, additive: boolean, round: boolean) {
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.baseCol = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.baseSize = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.gravity = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.shrink = new Uint8Array(max);
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.material = new THREE.ShaderMaterial({
      vertexShader: particleVertex,
      fragmentShader: particleFragment,
      uniforms: { pixelScale: { value: 1 }, round: { value: round ? 1 : 0 } },
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 10 : 9;
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, life: number, size: number, color: THREE.Color, gravity = 0, drag = 0, shrink = true): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = 0;
    this.baseCol[i * 3] = color.r;
    this.baseCol[i * 3 + 1] = color.g;
    this.baseCol[i * 3 + 2] = color.b;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.baseSize[i] = size;
    this.gravity[i] = gravity;
    this.drag[i] = drag;
    this.shrink[i] = shrink ? 1 : 0;
  }

  update(dt: number): number {
    let alive = 0;
    for (let i = 0; i < this.max; i += 1) {
      if (this.life[i] <= 0) {
        this.alpha[i] = 0;
        this.size[i] = 0;
        continue;
      }
      alive += 1;
      this.life[i] -= dt;
      const t = Math.max(0, this.life[i] / this.maxLife[i]);
      const d = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i * 3] *= d;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d - this.gravity[i] * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.size[i] = this.baseSize[i] * (this.shrink[i] ? 0.35 + 0.65 * t : 1);
      this.alpha[i] = Math.min(1, t * 1.6);
      this.col[i * 3] = this.baseCol[i * 3];
      this.col[i * 3 + 1] = this.baseCol[i * 3 + 1];
      this.col[i * 3 + 2] = this.baseCol[i * 3 + 2];
    }
    for (const name of ['position', 'color', 'size', 'alpha']) {
      (this.geometry.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true;
    }
    return alive;
  }

  clear(): void {
    this.life.fill(0);
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

interface Ring {
  mesh: THREE.Mesh;
  life: number;
  maxLife: number;
  maxScale: number;
}

interface Arc {
  mesh: THREE.Mesh;
  life: number;
}

export class Vfx {
  readonly group = new THREE.Group();
  private readonly glowPool = new ParticlePool(900, true, true);
  private readonly debrisPool = new ParticlePool(500, false, false);
  private readonly rings: Ring[] = [];
  private readonly arcs: Arc[] = [];
  private readonly lights: Array<{ light: THREE.PointLight; life: number; peak: number }> = [];
  private readonly tmp = new THREE.Color();
  private readonly ringGeo = new THREE.RingGeometry(0.7, 1, 20);
  private readonly arcGeo = new THREE.RingGeometry(1.2, 2.1, 12, 1, -Math.PI * 0.55, Math.PI * 1.05);
  private ringCursor = 0;
  private arcCursor = 0;
  lastAlive = 0;

  constructor(public rng: () => number) {
    this.group.add(this.glowPool.points, this.debrisPool.points);
    for (let i = 0; i < 12; i += 1) {
      const mat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(this.ringGeo, mat);
      mesh.visible = false;
      mesh.renderOrder = 11;
      this.group.add(mesh);
      this.rings.push({ mesh, life: 0, maxLife: 1, maxScale: 1 });
    }
    for (let i = 0; i < 4; i += 1) {
      const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#9ffcff').multiplyScalar(2.2), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(this.arcGeo, mat);
      mesh.visible = false;
      this.group.add(mesh);
      this.arcs.push({ mesh, life: 0 });
    }
    for (let i = 0; i < 3; i += 1) {
      const light = new THREE.PointLight('#ffb060', 0, 9, 1.6);
      this.group.add(light);
      this.lights.push({ light, life: 0, peak: 0 });
    }
  }

  /** scale = render-target height / (2 * tan(fov / 2)), i.e. pixels per world unit at depth 1. */
  setPixelScale(scale: number): void {
    this.glowPool.material.uniforms.pixelScale.value = scale;
    this.debrisPool.material.uniforms.pixelScale.value = scale;
  }

  private r(min: number, max: number): number {
    return min + (max - min) * this.rng();
  }

  muzzle(x: number, y: number, dirX: number, dirY: number, color: string): void {
    this.tmp.set(color).multiplyScalar(2.2);
    this.glowPool.emit(x, y, 0.6, dirX * 2, dirY * 2, 0.06, 0.6, this.tmp, 0, 0, true);
    for (let i = 0; i < 3; i += 1) {
      this.glowPool.emit(x, y, 0.6, dirX * this.r(4, 9) + this.r(-2, 2), dirY * this.r(4, 9) + this.r(-2, 2), this.r(0.05, 0.12), 0.18, this.tmp);
    }
  }

  sparks(x: number, y: number, color: string, count = 8, speed = 7): void {
    this.tmp.set(color).multiplyScalar(2.4);
    for (let i = 0; i < count; i += 1) {
      const a = this.r(0, Math.PI * 2);
      const s = this.r(speed * 0.4, speed);
      this.glowPool.emit(x, y, 0.8, Math.cos(a) * s, Math.sin(a) * s, this.r(0.12, 0.3), this.r(0.12, 0.22), this.tmp, 14, 2);
    }
  }

  ring(x: number, y: number, color: string, scale: number, life = 0.28): void {
    const ring = this.rings[this.ringCursor];
    this.ringCursor = (this.ringCursor + 1) % this.rings.length;
    ring.mesh.position.set(x, y, 0.9);
    (ring.mesh.material as THREE.MeshBasicMaterial).color.set(color).multiplyScalar(2);
    ring.life = life;
    ring.maxLife = life;
    ring.maxScale = scale;
    ring.mesh.visible = true;
  }

  explosion(x: number, y: number, scale = 1): void {
    const hot = new THREE.Color('#fff1b0').multiplyScalar(3);
    const orange = new THREE.Color('#ff8a2a').multiplyScalar(2.4);
    const red = new THREE.Color('#e0302a').multiplyScalar(1.8);
    const n = Math.floor(26 * scale);
    for (let i = 0; i < n; i += 1) {
      const a = this.r(0, Math.PI * 2);
      const s = this.r(1, 7) * scale;
      const c = i % 3 === 0 ? hot : i % 3 === 1 ? orange : red;
      this.glowPool.emit(x + this.r(-0.3, 0.3) * scale, y + this.r(-0.3, 0.3) * scale, 1, Math.cos(a) * s, Math.sin(a) * s + 1.5, this.r(0.25, 0.6), this.r(0.35, 0.8) * scale, c, -2, 3);
    }
    const debris = new THREE.Color('#2a2438');
    const metal = new THREE.Color('#8a90a8');
    for (let i = 0; i < Math.floor(14 * scale); i += 1) {
      const a = this.r(0.2, Math.PI - 0.2);
      const s = this.r(4, 11) * Math.sqrt(scale);
      this.debrisPool.emit(x, y, 1.1, Math.cos(a) * s, Math.sin(a) * s, this.r(0.5, 1.1), this.r(0.14, 0.26), i % 2 ? debris : metal, 22, 0.5, false);
    }
    const smoke = new THREE.Color('#3a3550');
    for (let i = 0; i < Math.floor(8 * scale); i += 1) {
      this.debrisPool.emit(x + this.r(-0.5, 0.5) * scale, y + this.r(0, 0.6) * scale, 0.7, this.r(-1, 1), this.r(1, 3), this.r(0.6, 1.1), this.r(0.5, 0.9) * scale, smoke, -1, 1.5, false);
    }
    this.ring(x, y, '#ffb347', 2.4 * scale, 0.32);
    const slot = this.lights.reduce((best, l) => (l.life < best.life ? l : best), this.lights[0]);
    slot.light.position.set(x, y, 2);
    slot.life = 0.35;
    slot.peak = 30 * scale;
  }

  saberArc(x: number, y: number, facing: number): void {
    const arc = this.arcs[this.arcCursor];
    this.arcCursor = (this.arcCursor + 1) % this.arcs.length;
    arc.mesh.position.set(x, y, 0.8);
    arc.mesh.scale.set(facing, 1, 1);
    arc.life = 0.16;
    arc.mesh.visible = true;
  }

  jetTrail(x: number, y: number): void {
    this.tmp.set('#ffb347').multiplyScalar(2);
    this.glowPool.emit(x + this.r(-0.1, 0.1), y, 0.2, this.r(-0.5, 0.5), this.r(-6, -3), this.r(0.1, 0.2), this.r(0.2, 0.35), this.tmp, 0, 2);
  }

  dust(x: number, y: number, count = 6): void {
    const c = new THREE.Color('#8f8ca8');
    for (let i = 0; i < count; i += 1) {
      this.debrisPool.emit(x + this.r(-0.4, 0.4), y + 0.05, 0.9, this.r(-3, 3), this.r(0.5, 2), this.r(0.2, 0.4), this.r(0.12, 0.22), c, 4, 3, true);
    }
  }

  electric(x: number, y: number): void {
    this.tmp.set('#8ff6ff').multiplyScalar(2.6);
    for (let i = 0; i < 3; i += 1) this.glowPool.emit(x + this.r(-0.5, 0.5), y + this.r(0, 1.5), 1, this.r(-2, 2), this.r(1, 4), 0.12, 0.18, this.tmp);
  }

  update(dt: number): void {
    this.lastAlive = this.glowPool.update(dt) + this.debrisPool.update(dt);
    for (const ring of this.rings) {
      if (ring.life <= 0) continue;
      ring.life -= dt;
      const t = 1 - Math.max(0, ring.life / ring.maxLife);
      ring.mesh.scale.setScalar(0.2 + t * ring.maxScale);
      (ring.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - t) * 0.9;
      if (ring.life <= 0) ring.mesh.visible = false;
    }
    for (const arc of this.arcs) {
      if (arc.life <= 0) continue;
      arc.life -= dt;
      (arc.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, arc.life / 0.16) * 0.9;
      if (arc.life <= 0) arc.mesh.visible = false;
    }
    for (const l of this.lights) {
      if (l.life <= 0) {
        l.light.intensity = 0;
        continue;
      }
      l.life -= dt;
      l.light.intensity = l.peak * Math.max(0, l.life / 0.35);
    }
  }

  clear(): void {
    this.glowPool.clear();
    this.debrisPool.clear();
    for (const ring of this.rings) {
      ring.life = 0;
      ring.mesh.visible = false;
    }
    for (const arc of this.arcs) {
      arc.life = 0;
      arc.mesh.visible = false;
    }
    for (const l of this.lights) {
      l.life = 0;
      l.light.intensity = 0;
    }
  }

  dispose(): void {
    this.glowPool.dispose();
    this.debrisPool.dispose();
    this.ringGeo.dispose();
    this.arcGeo.dispose();
  }
}
