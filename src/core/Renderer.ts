import * as THREE from 'three';

export const VIEW_HEIGHT_UNITS = 12;
const TARGET_LINES = 232;

export function createRenderer(canvas: HTMLCanvasElement): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    alpha: false,
    powerPreference: 'high-performance',
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.enabled = false;
  return renderer;
}

const compositeVertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const compositeFragment = /* glsl */ `
precision highp float;
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform vec2 resolution;
uniform float exposure;
uniform float cameraNear;
uniform float cameraFar;
uniform float outlineStrength;
uniform float flash;
uniform vec3 flashColor;
uniform float levels;
varying vec2 vUv;

float linearDepth(vec2 uv) {
  float z = texture2D(tDepth, uv).x * 2.0 - 1.0;
  return (2.0 * cameraNear * cameraFar) / (cameraFar + cameraNear - z * (cameraFar - cameraNear));
}

vec3 aces(vec3 x) {
  const float a = 2.51;
  const float b = 0.03;
  const float c = 2.43;
  const float d = 0.59;
  const float e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

vec3 toSRGB(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

float bayer4(vec2 p) {
  int x = int(mod(p.x, 4.0));
  int y = int(mod(p.y, 4.0));
  int i = x + y * 4;
  float m[16];
  m[0]=0.0; m[1]=8.0; m[2]=2.0; m[3]=10.0;
  m[4]=12.0; m[5]=4.0; m[6]=14.0; m[7]=6.0;
  m[8]=3.0; m[9]=11.0; m[10]=1.0; m[11]=9.0;
  m[12]=15.0; m[13]=7.0; m[14]=13.0; m[15]=5.0;
  float v = 0.0;
  for (int k = 0; k < 16; k++) { if (k == i) v = m[k]; }
  return v / 16.0 - 0.5;
}

void main() {
  vec2 texel = 1.0 / resolution;
  vec3 hdr = texture2D(tColor, vUv).rgb * exposure;

  float d = linearDepth(vUv);
  float dn = min(min(linearDepth(vUv + vec2(texel.x, 0.0)), linearDepth(vUv - vec2(texel.x, 0.0))),
                 min(linearDepth(vUv + vec2(0.0, texel.y)), linearDepth(vUv - vec2(0.0, texel.y))));
  float edge = step(0.06 * dn + 0.25, d - dn) * step(dn, 60.0);

  vec3 col = aces(hdr);
  col = toSRGB(col);
  float luma = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(luma), col, 1.12);
  col = mix(col, col * vec3(0.05, 0.04, 0.09), edge * outlineStrength);
  col = mix(col, flashColor, flash);

  vec2 pixel = floor(vUv * resolution);
  col += bayer4(pixel) / levels;
  col = floor(col * levels + 0.5) / levels;
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

/**
 * Renders the scene into an SNES-resolution HDR target, then composites it to the
 * canvas with tone mapping, 15-bit quantisation, ordered dither and depth outlines,
 * upscaled by an integer factor with nearest filtering.
 */
export class PixelPipeline {
  readonly target: THREE.WebGLRenderTarget;
  width = 1;
  height = 1;
  scale = 1;
  private readonly quadScene = new THREE.Scene();
  private readonly quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  readonly material: THREE.ShaderMaterial;

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    const depthTexture = new THREE.DepthTexture(1, 1);
    depthTexture.type = THREE.UnsignedIntType;
    this.target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthTexture,
      depthBuffer: true,
    });
    this.material = new THREE.ShaderMaterial({
      vertexShader: compositeVertex,
      fragmentShader: compositeFragment,
      uniforms: {
        tColor: { value: this.target.texture },
        tDepth: { value: depthTexture },
        resolution: { value: new THREE.Vector2(1, 1) },
        exposure: { value: 1.0 },
        cameraNear: { value: 1 },
        cameraFar: { value: 100 },
        outlineStrength: { value: 0.85 },
        flash: { value: 0 },
        flashColor: { value: new THREE.Color('#ffffff') },
        levels: { value: 31 },
      },
      depthTest: false,
      depthWrite: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    quad.frustumCulled = false;
    this.quadScene.add(quad);
  }

  resize(camera: THREE.PerspectiveCamera, maxDpr: number): boolean {
    const canvas = this.renderer.domElement;
    const cssW = Math.max(1, Math.floor(canvas.clientWidth));
    const cssH = Math.max(1, Math.floor(canvas.clientHeight));
    const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
    const bufferW = Math.floor(cssW * dpr);
    const bufferH = Math.floor(cssH * dpr);
    if (canvas.width === bufferW && canvas.height === bufferH && this.width > 1) return false;

    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(cssW, cssH, false);
    this.scale = Math.max(1, Math.round(bufferH / TARGET_LINES));
    this.width = Math.ceil(bufferW / this.scale);
    this.height = Math.ceil(bufferH / this.scale);
    this.target.setSize(this.width, this.height);
    (this.material.uniforms.resolution.value as THREE.Vector2).set(this.width, this.height);
    camera.aspect = this.width / this.height;
    camera.updateProjectionMatrix();
    return true;
  }

  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera): void {
    this.material.uniforms.cameraNear.value = camera.near;
    this.material.uniforms.cameraFar.value = camera.far;
    this.renderer.setRenderTarget(this.target);
    this.renderer.render(scene, camera);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.quadScene, this.quadCamera);
  }

  dispose(): void {
    this.target.depthTexture?.dispose();
    this.target.dispose();
    this.material.dispose();
  }
}
