import GUI from 'lil-gui';

export type DebugTuning = {
  exposure: number;
  maxDpr: number;
  outline: number;
  walkSpeed: number;
  jetAccel: number;
};

export class DebugTools {
  private gui: GUI | null = null;

  constructor(tuning: DebugTuning, onChange: () => void) {
    const enabled = import.meta.env.DEV && new URLSearchParams(window.location.search).has('debug');
    if (!enabled) return;

    this.gui = new GUI({ title: 'Iron Nitro tuning' });
    this.gui.add(tuning, 'exposure', 0.5, 2, 0.01).onChange(onChange);
    this.gui.add(tuning, 'outline', 0, 1, 0.01).onChange(onChange);
    this.gui.add(tuning, 'maxDpr', 1, 2, 0.25).onChange(onChange);
    this.gui.add(tuning, 'walkSpeed', 3, 12, 0.1).onChange(onChange);
    this.gui.add(tuning, 'jetAccel', 30, 120, 1).onChange(onChange);
  }

  setHidden(hidden: boolean): void {
    if (!this.gui) return;
    if (hidden) this.gui.hide();
    else this.gui.show();
  }

  dispose(): void {
    this.gui?.destroy();
    this.gui = null;
  }
}
