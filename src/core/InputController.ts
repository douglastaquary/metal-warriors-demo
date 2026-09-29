export type ButtonIntent = 'jump' | 'fire' | 'saber' | 'shield' | 'pause' | 'start';

const KEY_BINDINGS: Record<string, ButtonIntent> = {
  KeyZ: 'jump',
  KeyK: 'jump',
  Space: 'jump',
  KeyX: 'fire',
  KeyJ: 'fire',
  KeyC: 'saber',
  KeyL: 'saber',
  KeyV: 'shield',
  KeyI: 'shield',
  ShiftLeft: 'shield',
  ShiftRight: 'shield',
  Escape: 'pause',
  KeyP: 'pause',
  Enter: 'start',
};

const PAD_BINDINGS: Array<[number, ButtonIntent]> = [
  [0, 'jump'],
  [2, 'fire'],
  [7, 'fire'],
  [1, 'saber'],
  [3, 'saber'],
  [4, 'shield'],
  [5, 'shield'],
  [6, 'shield'],
  [9, 'start'],
  [8, 'pause'],
];

const ALL_BUTTONS: ButtonIntent[] = ['jump', 'fire', 'saber', 'shield', 'pause', 'start'];

export class InputController {
  readonly axis = { x: 0, y: 0 };
  lastDevice: 'keyboard' | 'touch' | 'gamepad' = 'keyboard';

  private readonly keys = new Set<string>();
  private readonly keyButtons = new Set<ButtonIntent>();
  private readonly touchButtons = new Set<ButtonIntent>();
  private readonly padButtons = new Set<ButtonIntent>();
  private readonly held = new Set<ButtonIntent>();
  private readonly pressed = new Set<ButtonIntent>();
  private readonly touchAxis = { x: 0, y: 0 };
  private readonly padAxis = { x: 0, y: 0 };
  private stickPointer: number | null = null;
  private stickCenter = { x: 0, y: 0, r: 1 };
  private readonly buttonPointers = new Map<number, ButtonIntent>();
  private readonly cleanups: Array<() => void> = [];

  constructor(
    private readonly stick: HTMLElement,
    private readonly knob: HTMLElement,
    touchButtons: HTMLElement[],
  ) {
    this.listen(window, 'keydown', (event) => this.onKey(event as KeyboardEvent, true));
    this.listen(window, 'keyup', (event) => this.onKey(event as KeyboardEvent, false));
    this.listen(window, 'blur', () => this.releaseAll());
    this.listen(document, 'visibilitychange', () => {
      if (document.hidden) this.releaseAll();
    });

    this.listen(stick, 'pointerdown', (event) => this.onStickDown(event as PointerEvent));
    this.listen(stick, 'pointermove', (event) => this.onStickMove(event as PointerEvent));
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      this.listen(stick, type, (event) => this.onStickUp(event as PointerEvent));
    }

    for (const button of touchButtons) {
      const intent = button.dataset.intent as ButtonIntent | undefined;
      if (!intent) continue;
      this.listen(button, 'pointerdown', (event) => {
        const pointer = event as PointerEvent;
        pointer.preventDefault();
        this.lastDevice = 'touch';
        this.buttonPointers.set(pointer.pointerId, intent);
        try {
          button.setPointerCapture(pointer.pointerId);
        } catch {
          // Synthetic events may not be capturable.
        }
        this.touchButtons.add(intent);
        button.classList.add('is-pressed');
        this.pressed.add(intent);
      });
      const release = (event: Event) => {
        const pointer = event as PointerEvent;
        const owned = this.buttonPointers.get(pointer.pointerId);
        if (owned !== intent) return;
        this.buttonPointers.delete(pointer.pointerId);
        let stillHeld = false;
        for (const other of this.buttonPointers.values()) if (other === intent) stillHeld = true;
        if (!stillHeld) {
          this.touchButtons.delete(intent);
          button.classList.remove('is-pressed');
        }
      };
      for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
        this.listen(button, type, release);
      }
    }
  }

  /** Call once per rendered frame before simulation steps. */
  poll(): void {
    this.pollGamepad();
    let x = 0;
    let y = 0;
    if (this.keys.has('ArrowLeft') || this.keys.has('KeyA')) x -= 1;
    if (this.keys.has('ArrowRight') || this.keys.has('KeyD')) x += 1;
    if (this.keys.has('ArrowUp') || this.keys.has('KeyW')) y += 1;
    if (this.keys.has('ArrowDown') || this.keys.has('KeyS')) y -= 1;
    x += this.touchAxis.x + this.padAxis.x;
    y += this.touchAxis.y + this.padAxis.y;
    this.axis.x = Math.max(-1, Math.min(1, x));
    this.axis.y = Math.max(-1, Math.min(1, y));

    for (const intent of ALL_BUTTONS) {
      const down = this.keyButtons.has(intent) || this.touchButtons.has(intent) || this.padButtons.has(intent);
      if (down && !this.held.has(intent)) this.pressed.add(intent);
      if (down) this.held.add(intent);
      else this.held.delete(intent);
    }
  }

  isHeld(intent: ButtonIntent): boolean {
    return this.held.has(intent);
  }

  consume(intent: ButtonIntent): boolean {
    if (!this.pressed.has(intent)) return false;
    this.pressed.delete(intent);
    return true;
  }

  clearPresses(): void {
    this.pressed.clear();
  }

  releaseAll(): void {
    this.keys.clear();
    this.keyButtons.clear();
    this.touchButtons.clear();
    this.buttonPointers.clear();
    this.held.clear();
    this.pressed.clear();
    this.touchAxis.x = 0;
    this.touchAxis.y = 0;
    this.stickPointer = null;
    this.updateKnob();
    document.querySelectorAll('.is-pressed').forEach((el) => el.classList.remove('is-pressed'));
  }

  dispose(): void {
    for (const cleanup of this.cleanups) cleanup();
    this.cleanups.length = 0;
  }

  private listen(target: EventTarget, type: string, handler: (event: Event) => void): void {
    target.addEventListener(type, handler, { passive: false });
    this.cleanups.push(() => target.removeEventListener(type, handler));
  }

  private onKey(event: KeyboardEvent, down: boolean): void {
    const intent = KEY_BINDINGS[event.code];
    const isArrow = event.code.startsWith('Arrow');
    if (intent || isArrow) event.preventDefault();
    if (event.repeat) return;
    this.lastDevice = 'keyboard';
    if (down) this.keys.add(event.code);
    else this.keys.delete(event.code);
    if (!intent) return;
    let anyDown = false;
    for (const [code, mapped] of Object.entries(KEY_BINDINGS)) {
      if (mapped === intent && this.keys.has(code)) anyDown = true;
    }
    if (anyDown) {
      if (!this.keyButtons.has(intent)) this.pressed.add(intent);
      this.keyButtons.add(intent);
    } else {
      this.keyButtons.delete(intent);
    }
  }

  private onStickDown(event: PointerEvent): void {
    event.preventDefault();
    this.lastDevice = 'touch';
    const rect = this.stick.getBoundingClientRect();
    this.stickPointer = event.pointerId;
    this.stickCenter = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, r: rect.width * 0.36 };
    try {
      this.stick.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic events may not be capturable.
    }
    this.updateStick(event.clientX, event.clientY);
  }

  private onStickMove(event: PointerEvent): void {
    if (event.pointerId !== this.stickPointer) return;
    event.preventDefault();
    this.updateStick(event.clientX, event.clientY);
  }

  private onStickUp(event: PointerEvent): void {
    if (event.pointerId !== this.stickPointer) return;
    this.stickPointer = null;
    this.touchAxis.x = 0;
    this.touchAxis.y = 0;
    this.updateKnob();
  }

  private updateStick(clientX: number, clientY: number): void {
    let dx = (clientX - this.stickCenter.x) / this.stickCenter.r;
    let dy = -(clientY - this.stickCenter.y) / this.stickCenter.r;
    const len = Math.hypot(dx, dy);
    if (len > 1) {
      dx /= len;
      dy /= len;
    }
    // Digital-feeling d-pad: dead zone then snap each axis like a SNES pad.
    this.touchAxis.x = Math.abs(dx) > 0.3 ? Math.sign(dx) : 0;
    this.touchAxis.y = Math.abs(dy) > 0.45 ? Math.sign(dy) : 0;
    this.updateKnob(dx, dy);
  }

  private updateKnob(dx = 0, dy = 0): void {
    const travel = 26;
    this.knob.style.transform = `translate(calc(-50% + ${dx * travel}px), calc(-50% + ${-dy * travel}px))`;
  }

  private pollGamepad(): void {
    this.padButtons.clear();
    this.padAxis.x = 0;
    this.padAxis.y = 0;
    const pads = navigator.getGamepads?.() ?? [];
    for (const pad of pads) {
      if (!pad) continue;
      let used = false;
      for (const [index, intent] of PAD_BINDINGS) {
        if (pad.buttons[index]?.pressed) {
          this.padButtons.add(intent);
          used = true;
        }
      }
      const ax = pad.axes[0] ?? 0;
      const ay = pad.axes[1] ?? 0;
      if (Math.abs(ax) > 0.35) this.padAxis.x = Math.sign(ax);
      if (Math.abs(ay) > 0.5) this.padAxis.y = -Math.sign(ay);
      if (pad.buttons[14]?.pressed) this.padAxis.x = -1;
      if (pad.buttons[15]?.pressed) this.padAxis.x = 1;
      if (pad.buttons[12]?.pressed) this.padAxis.y = 1;
      if (pad.buttons[13]?.pressed) this.padAxis.y = -1;
      if (used || this.padAxis.x !== 0 || this.padAxis.y !== 0) this.lastDevice = 'gamepad';
    }
  }
}
