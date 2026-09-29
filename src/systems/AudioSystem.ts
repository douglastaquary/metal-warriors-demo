type Track = 'title' | 'stage' | 'boss' | 'none';

interface Song {
  bpm: number;
  root: number;
  bass: Array<number | null>;
  lead: Array<number | null>;
  arp: number[][];
  drums: string;
}

const SONGS: Record<Exclude<Track, 'none'>, Song> = {
  title: {
    bpm: 104,
    root: 45,
    bass: [0, null, 0, null, 7, null, 5, null, 3, null, 3, null, 5, null, 7, null],
    lead: [12, null, null, 15, null, 14, null, 12, 10, null, null, null, 7, null, 10, null, 12, null, null, 15, null, 17, null, 19, 17, null, null, null, 15, null, 14, null],
    arp: [[0, 3, 7, 12], [0, 3, 7, 12], [-2, 2, 5, 10], [-4, 0, 3, 8]],
    drums: 'k...h...s...h...k...h...s..hh...',
  },
  stage: {
    bpm: 148,
    root: 45,
    bass: [0, 0, 12, 0, 0, 12, 0, 10, -2, -2, 10, -2, 3, 3, 5, 7],
    lead: [12, null, 15, 17, null, 19, null, 17, 15, null, 12, null, 10, 12, null, null, 12, null, 15, 17, null, 22, null, 19, 17, null, 15, 14, 15, null, null, null],
    arp: [[0, 7, 12, 15], [0, 7, 12, 15], [-2, 5, 10, 14], [3, 7, 10, 15]],
    drums: 'k.h.s.hkk.h.s.hhk.h.s.hkk.hss.sh',
  },
  boss: {
    bpm: 168,
    root: 40,
    bass: [0, 0, 0, 1, 0, 0, 3, 1, 0, 0, 0, 1, 6, 5, 3, 1],
    lead: [12, 13, 12, null, 15, null, 13, 12, 18, null, 17, null, 15, 13, 12, null, 12, 13, 12, null, 15, null, 18, 19, 18, null, 17, 15, 13, null, 12, null],
    arp: [[0, 3, 6, 12], [0, 3, 6, 12], [1, 5, 8, 13], [-1, 3, 6, 11]],
    drums: 'kkhskkhskkhskshskkhskkhskkhsssss',
  },
};

function midiToHz(note: number): number {
  return 440 * Math.pow(2, (note - 69) / 12);
}

export class AudioSystem {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private jetGain: GainNode | null = null;
  private jetFilter: BiquadFilterNode | null = null;
  private track: Track = 'none';
  private pendingTrack: Track = 'none';
  private step = 0;
  private nextStepTime = 0;
  private scheduler: number | null = null;
  private muted = false;
  private lastPlayed = new Map<string, number>();
  rng: () => number = () => 0.5;

  constructor() {
    const unlock = () => {
      void this.unlock();
    };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    window.addEventListener('touchend', unlock, { once: true });
  }

  get isMuted(): boolean {
    return this.muted;
  }

  get state(): string {
    return this.ctx?.state ?? 'locked';
  }

  async unlock(): Promise<void> {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = 0.9;
    this.sfxBus.connect(this.master);
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 0.34;
    this.musicBus.connect(this.master);

    const len = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    let seed = 1234567;
    for (let i = 0; i < len; i += 1) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      data[i] = (seed / 0x7fffffff) * 2 - 1;
    }

    const jetSrc = ctx.createBufferSource();
    jetSrc.buffer = this.noise;
    jetSrc.loop = true;
    this.jetFilter = ctx.createBiquadFilter();
    this.jetFilter.type = 'bandpass';
    this.jetFilter.frequency.value = 700;
    this.jetFilter.Q.value = 0.8;
    this.jetGain = ctx.createGain();
    this.jetGain.gain.value = 0;
    jetSrc.connect(this.jetFilter).connect(this.jetGain).connect(this.sfxBus);
    jetSrc.start();

    await ctx.resume();
    this.nextStepTime = ctx.currentTime + 0.05;
    this.scheduler = window.setInterval(() => this.schedule(), 25);
    if (this.pendingTrack !== 'none') this.playMusic(this.pendingTrack);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(muted ? 0 : 0.8, this.ctx.currentTime, 0.02);
  }

  setPaused(paused: boolean): void {
    if (!this.ctx) return;
    if (paused) void this.ctx.suspend();
    else void this.ctx.resume();
  }

  duck(amount: number, seconds: number): void {
    if (!this.ctx || !this.musicBus) return;
    const now = this.ctx.currentTime;
    this.musicBus.gain.cancelScheduledValues(now);
    this.musicBus.gain.setValueAtTime(0.34 * amount, now);
    this.musicBus.gain.linearRampToValueAtTime(0.34, now + seconds);
  }

  playMusic(track: Track): void {
    this.pendingTrack = track;
    if (!this.ctx) return;
    if (this.track === track) return;
    this.track = track;
    this.step = 0;
    this.nextStepTime = this.ctx.currentTime + 0.08;
  }

  setJet(level: number): void {
    if (!this.ctx || !this.jetGain || !this.jetFilter) return;
    this.jetGain.gain.setTargetAtTime(level * 0.28, this.ctx.currentTime, 0.04);
    this.jetFilter.frequency.setTargetAtTime(500 + level * 900, this.ctx.currentTime, 0.05);
  }

  // ---- SFX ------------------------------------------------------------------

  private ready(key: string, minGap: number): boolean {
    if (!this.ctx || this.ctx.state !== 'running') return false;
    const now = this.ctx.currentTime;
    const last = this.lastPlayed.get(key) ?? -1;
    if (now - last < minGap) return false;
    this.lastPlayed.set(key, now);
    return true;
  }

  private vary(amount = 0.08): number {
    return 1 + (this.rng() - 0.5) * 2 * amount;
  }

  private tone(type: OscillatorType, f0: number, f1: number, dur: number, vol: number, when = 0): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.sfxBus!);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private burst(dur: number, vol: number, filter: BiquadFilterType, f0: number, f1: number, when = 0, q = 1): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = this.vary(0.1);
    const bq = ctx.createBiquadFilter();
    bq.type = filter;
    bq.Q.value = q;
    bq.frequency.setValueAtTime(f0, t);
    bq.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bq).connect(g).connect(this.sfxBus!);
    src.start(t, this.rng() * 0.5);
    src.stop(t + dur + 0.02);
  }

  shoot(spread: boolean): void {
    if (!this.ready('shoot', 0.05)) return;
    const v = this.vary();
    this.tone('square', 1400 * v, 260 * v, 0.09, 0.09);
    this.burst(0.06, 0.12, 'highpass', 3000, 1200);
    if (spread) this.tone('sawtooth', 900 * v, 180, 0.1, 0.05);
  }

  enemyShot(): void {
    if (!this.ready('eshot', 0.06)) return;
    const v = this.vary();
    this.tone('sawtooth', 520 * v, 140 * v, 0.16, 0.07);
  }

  saber(): void {
    if (!this.ready('saber', 0.08)) return;
    this.burst(0.18, 0.2, 'bandpass', 900, 3800, 0, 2.5);
    this.tone('sawtooth', 220, 660, 0.14, 0.05);
  }

  deflect(): void {
    if (!this.ready('deflect', 0.04)) return;
    this.tone('square', 1800 * this.vary(), 2400, 0.08, 0.08);
    this.tone('triangle', 3200, 1600, 0.12, 0.05, 0.02);
  }

  shieldBlock(): void {
    if (!this.ready('block', 0.05)) return;
    this.tone('triangle', 900 * this.vary(), 700, 0.12, 0.1);
    this.burst(0.08, 0.08, 'highpass', 4000, 2000);
  }

  hit(): void {
    if (!this.ready('hit', 0.03)) return;
    this.burst(0.07, 0.18, 'bandpass', 2400 * this.vary(), 900, 0, 3);
    this.tone('square', 300 * this.vary(), 120, 0.06, 0.06);
  }

  playerHit(): void {
    if (!this.ready('phit', 0.1)) return;
    this.tone('sawtooth', 200, 60, 0.3, 0.16);
    this.burst(0.25, 0.25, 'lowpass', 2000, 200);
  }

  explosion(size: number): void {
    if (!this.ready('boom' + (size > 1.5 ? 'L' : 'S'), 0.05)) return;
    const d = 0.4 + size * 0.35;
    this.burst(d, 0.35 + size * 0.1, 'lowpass', 1800 * this.vary(), 60, 0, 0.7);
    this.tone('sine', 120 * this.vary(), 30, d, 0.35);
    if (size > 1.5) this.burst(d * 1.4, 0.2, 'lowpass', 600, 40, 0.1);
  }

  jump(): void {
    if (!this.ready('jump', 0.08)) return;
    this.tone('square', 180, 360, 0.1, 0.06);
    this.burst(0.1, 0.08, 'lowpass', 1200, 300);
  }

  land(): void {
    if (!this.ready('land', 0.12)) return;
    this.tone('sine', 110, 45, 0.14, 0.2);
    this.burst(0.1, 0.12, 'lowpass', 800, 100);
  }

  footstep(): void {
    if (!this.ready('step', 0.12)) return;
    this.tone('sine', 90 * this.vary(0.1), 40, 0.09, 0.12);
    this.burst(0.05, 0.05, 'lowpass', 900, 200);
  }

  pickup(): void {
    if (!this.ready('pickup', 0.05)) return;
    [0, 4, 7, 12].forEach((n, i) => this.tone('square', midiToHz(76 + n), midiToHz(76 + n), 0.08, 0.06, i * 0.05));
  }

  powerUp(): void {
    if (!this.ready('power', 0.2)) return;
    [0, 3, 7, 10, 12, 15, 19, 24].forEach((n, i) => this.tone('square', midiToHz(64 + n), midiToHz(64 + n), 0.07, 0.06, i * 0.045));
  }

  checkpoint(): void {
    if (!this.ready('cp', 0.3)) return;
    [0, 7, 12].forEach((n, i) => this.tone('triangle', midiToHz(72 + n), midiToHz(72 + n), 0.18, 0.1, i * 0.09));
  }

  alarm(): void {
    if (!this.ready('alarm', 0.5)) return;
    for (let i = 0; i < 4; i += 1) {
      this.tone('square', 880, 660, 0.22, 0.07, i * 0.3);
    }
  }

  telegraph(): void {
    if (!this.ready('tele', 0.15)) return;
    this.tone('sine', 400, 1400, 0.25, 0.04);
  }

  stomp(): void {
    if (!this.ready('stomp', 0.2)) return;
    this.tone('sine', 70, 25, 0.5, 0.45);
    this.burst(0.4, 0.3, 'lowpass', 500, 40);
  }

  uiMove(): void {
    if (!this.ready('uimove', 0.04)) return;
    this.tone('square', 660, 660, 0.04, 0.05);
  }

  uiSelect(): void {
    if (!this.ready('uisel', 0.08)) return;
    this.tone('square', 880, 880, 0.05, 0.06);
    this.tone('square', 1320, 1320, 0.08, 0.06, 0.05);
  }

  jingle(kind: 'gameover' | 'clear' | 'death'): void {
    if (!this.ready('jingle', 0.5)) return;
    const seq = kind === 'clear' ? [0, 4, 7, 12, 7, 12, 16, 19] : kind === 'gameover' ? [12, 11, 7, 6, 3, 2, 0, -5] : [7, 3, 0, -5];
    seq.forEach((n, i) => this.tone(kind === 'clear' ? 'square' : 'triangle', midiToHz(64 + n), midiToHz(64 + n), 0.16, 0.08, i * 0.12));
  }

  // ---- Music sequencer -------------------------------------------------------

  private schedule(): void {
    if (!this.ctx || this.ctx.state !== 'running' || this.track === 'none') return;
    const song = SONGS[this.track];
    const stepDur = 60 / song.bpm / 4;
    while (this.nextStepTime < this.ctx.currentTime + 0.12) {
      this.playStep(song, this.step, this.nextStepTime, stepDur);
      this.nextStepTime += stepDur;
      this.step += 1;
    }
  }

  private voice(type: OscillatorType, note: number, t: number, dur: number, vol: number, cutoff = 0): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(midiToHz(note), t);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node: AudioNode = osc;
    if (cutoff > 0) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(cutoff * 2.5, t);
      f.frequency.exponentialRampToValueAtTime(cutoff, t + dur);
      osc.connect(f);
      node = f;
    }
    node.connect(g).connect(this.musicBus!);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private drum(kind: string, t: number): void {
    const ctx = this.ctx!;
    if (kind === 'k') {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.frequency.setValueAtTime(140, t);
      osc.frequency.exponentialRampToValueAtTime(40, t + 0.12);
      g.gain.setValueAtTime(0.6, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      osc.connect(g).connect(this.musicBus!);
      osc.start(t);
      osc.stop(t + 0.18);
      return;
    }
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    const g = ctx.createGain();
    const dur = kind === 's' ? 0.14 : 0.04;
    f.type = kind === 's' ? 'bandpass' : 'highpass';
    f.frequency.value = kind === 's' ? 1800 : 7000;
    g.gain.setValueAtTime(kind === 's' ? 0.35 : 0.12, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.musicBus!);
    src.start(t, (this.step * 0.137) % 0.8);
    src.stop(t + dur + 0.01);
  }

  private playStep(song: Song, step: number, t: number, stepDur: number): void {
    const bar = Math.floor(step / 16) % 4;
    const s16 = step % 16;
    const bass = song.bass[s16];
    if (bass !== null) this.voice('sawtooth', song.root + bass - 12, t, stepDur * 0.9, 0.22, 420);
    const lead = song.lead[step % song.lead.length];
    if (lead !== null && bar !== 3) this.voice('square', song.root + 12 + lead, t, stepDur * 1.6, 0.07, 2600);
    const chord = song.arp[bar];
    this.voice('square', song.root + 24 + chord[s16 % 4], t, stepDur * 0.5, 0.025);
    const d = song.drums[step % song.drums.length];
    if (d === 'k' || d === 's' || d === 'h') this.drum(d, t);
    if (d === 'k' && s16 % 8 === 4) this.drum('h', t);
  }

  dispose(): void {
    if (this.scheduler !== null) window.clearInterval(this.scheduler);
    void this.ctx?.close();
    this.ctx = null;
  }
}
