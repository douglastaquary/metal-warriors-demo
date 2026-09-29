export type OverlayName = 'title' | 'pause' | 'gameover' | 'clear' | null;

export interface HudState {
  armor: number;
  armorMax: number;
  energy: number;
  energyMax: number;
  lives: number;
  score: number;
  spread: boolean;
  section: string;
  progress: number;
  bossVisible: boolean;
  bossRatio: number;
}

function el<T extends HTMLElement = HTMLElement>(selector: string): T {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`Missing HUD element ${selector}`);
  return node;
}

export class Hud {
  private readonly segments: HTMLElement[] = [];
  private readonly armorMeter = el('.meter.armor');
  private readonly energyMeter = el('.meter.energy');
  private readonly energyFill = el('#energy-fill');
  private readonly lives = el('#lives-value');
  private readonly score = el('#score-value');
  private readonly weapon = el('#weapon-badge');
  private readonly section = el('#section-label');
  private readonly progressFill = el('#progress-fill');
  private readonly progressDot = el('#progress-dot');
  private readonly bossHud = el('#boss-hud');
  private readonly bossFill = el('#boss-fill');
  private readonly banner = el('#banner');
  private readonly popups = el('#popups');
  private readonly flash = el('#flash');
  private readonly app = el('#app');
  private readonly overlays: Record<Exclude<OverlayName, null>, HTMLElement> = {
    title: el('#overlay-title'),
    pause: el('#overlay-pause'),
    gameover: el('#overlay-gameover'),
    clear: el('#overlay-clear'),
  };
  private bannerTimer: number | null = null;
  private last: Partial<HudState> = {};
  private lastArmorSegments = -1;

  constructor() {
    const container = el('#armor-segments');
    for (let i = 0; i < 12; i += 1) {
      const seg = document.createElement('i');
      container.appendChild(seg);
      this.segments.push(seg);
    }
    this.drawPortrait();
  }

  setMarkers(checkpoints: number[], boss: number): void {
    const track = el('.progress-track');
    const add = (cls: string, fraction: number) => {
      const marker = document.createElement('i');
      marker.className = `marker ${cls}`;
      marker.style.left = `${(fraction * 100).toFixed(1)}%`;
      track.insertBefore(marker, this.progressDot);
    };
    for (const cp of checkpoints) add('cp', cp);
    add('boss', boss);
  }

  setAppState(state: string): void {
    this.app.dataset.state = state;
  }

  showOverlay(name: OverlayName): void {
    for (const [key, node] of Object.entries(this.overlays)) {
      node.hidden = key !== name;
    }
    if (name) {
      const primary = this.overlays[name].querySelector<HTMLButtonElement>('.primary-btn');
      primary?.focus({ preventScroll: true });
    }
  }

  update(s: HudState): void {
    const segs = Math.ceil((s.armor / s.armorMax) * 12);
    if (segs !== this.lastArmorSegments) {
      this.segments.forEach((seg, i) => seg.classList.toggle('off', i >= segs));
      this.armorMeter.classList.toggle('low', segs <= 3);
      if (this.lastArmorSegments > segs) this.pulse(this.armorMeter);
      this.lastArmorSegments = segs;
    }
    const ratio = Math.max(0, s.energy / s.energyMax);
    this.energyFill.style.transform = `scaleX(${Math.round(ratio * 48) / 48})`;
    this.energyMeter.classList.toggle('drained', ratio < 0.2);
    if (this.last.lives !== s.lives) this.lives.textContent = String(s.lives);
    if (this.last.score !== s.score) {
      this.score.textContent = String(Math.min(9999999, s.score)).padStart(7, '0');
      if ((this.last.score ?? 0) < s.score) this.pulse(this.score);
    }
    if (this.last.spread !== s.spread) {
      this.weapon.textContent = s.spread ? 'SPREAD' : 'RIFLE';
      this.weapon.classList.toggle('spread', s.spread);
    }
    if (this.last.section !== s.section) this.section.textContent = s.section;
    const pct = `${(Math.max(0, Math.min(1, s.progress)) * 100).toFixed(1)}%`;
    this.progressFill.style.width = pct;
    this.progressDot.style.left = pct;
    if (this.last.bossVisible !== s.bossVisible) this.bossHud.hidden = !s.bossVisible;
    if (s.bossVisible) this.bossFill.style.transform = `scaleX(${Math.max(0, s.bossRatio)})`;
    this.last = { ...s };
  }

  showBanner(main: string, sub = '', variant: '' | 'warning' | 'good' = '', ms = 1800): void {
    this.banner.className = variant;
    this.banner.innerHTML = '';
    const m = document.createElement('div');
    m.className = 'banner-main';
    m.textContent = main;
    this.banner.appendChild(m);
    if (sub) {
      const s = document.createElement('div');
      s.className = 'banner-sub';
      s.textContent = sub;
      this.banner.appendChild(s);
    }
    if (this.bannerTimer !== null) window.clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => {
      this.banner.innerHTML = '';
      this.bannerTimer = null;
    }, ms);
  }

  clearBanner(): void {
    if (this.bannerTimer !== null) window.clearTimeout(this.bannerTimer);
    this.bannerTimer = null;
    this.banner.innerHTML = '';
  }

  popup(text: string, xPct: number, yPct: number, big = false): void {
    if (xPct < -0.1 || xPct > 1.1 || yPct < -0.1 || yPct > 1.1) return;
    const node = document.createElement('div');
    node.className = big ? 'popup big' : 'popup';
    node.textContent = text;
    node.style.left = `${xPct * 100}%`;
    node.style.top = `${yPct * 100}%`;
    this.popups.appendChild(node);
    window.setTimeout(() => node.remove(), 820);
    while (this.popups.childElementCount > 14) this.popups.firstElementChild?.remove();
  }

  screenFlash(color: string, strength: number): void {
    this.flash.style.background = color;
    this.flash.animate([{ opacity: Math.min(0.85, strength) }, { opacity: 0 }], { duration: 120 + strength * 120, easing: 'steps(4)' });
  }

  setGameOverScore(score: number): void {
    el('#gameover-score').textContent = String(score).padStart(7, '0');
  }

  setClearStats(score: number, seconds: number, kills: number, deaths: number): void {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    el('#clear-score').textContent = String(score).padStart(7, '0');
    el('#clear-time').textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    el('#clear-kills').textContent = String(kills);
    el('#clear-deaths').textContent = String(deaths);
  }

  setMuted(muted: boolean): void {
    el('#btn-mute').classList.toggle('muted', muted);
    document.querySelectorAll('.sound-state').forEach((n) => (n.textContent = muted ? 'OFF' : 'ON'));
  }

  private pulse(node: HTMLElement): void {
    node.animate([{ transform: 'scale(1.15)' }, { transform: 'scale(1)' }], { duration: 140, easing: 'steps(3)' });
  }

  private drawPortrait(): void {
    const canvas = el<HTMLCanvasElement>('#portrait');
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const px = (c: string, x: number, y: number, w = 1, h = 1) => {
      ctx.fillStyle = c;
      ctx.fillRect(x, y, w, h);
    };
    px('#1b2a4a', 0, 0, 24, 24);
    for (let y = 0; y < 24; y += 2) px('#22345a', 0, y, 24, 1);
    px('#8f2a1c', 4, 7, 16, 13);
    px('#d8482a', 5, 7, 14, 11);
    px('#e9a45c', 3, 5, 6, 5);
    px('#e9a45c', 15, 5, 6, 5);
    px('#f4c430', 3, 9, 6, 1);
    px('#f4c430', 15, 9, 6, 1);
    px('#39405a', 9, 3, 6, 5);
    px('#38e0e8', 10, 5, 4, 1);
    px('#9ff8ff', 10, 5, 1, 1);
    px('#0b5a66', 9, 11, 6, 5);
    px('#38e0e8', 10, 11, 4, 4);
    px('#c8ffff', 10, 11, 2, 1);
    px('#f4c430', 5, 17, 14, 1);
    px('#39405a', 6, 19, 4, 5);
    px('#39405a', 14, 19, 4, 5);
  }
}
