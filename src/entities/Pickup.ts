import * as THREE from 'three';
import { createPickupModel, type PickupKind } from '../graphics/Props';

export class Pickup {
  readonly group: THREE.Group;
  active = true;
  private popTimer = -1;
  private readonly ring: THREE.Object3D | undefined;

  constructor(readonly kind: PickupKind, readonly x: number, readonly y: number) {
    this.group = createPickupModel(kind);
    this.ring = this.group.getObjectByName('ring');
    this.group.position.set(x, y, 0.2);
  }

  collect(): void {
    this.active = false;
    this.popTimer = 0;
  }

  reset(): void {
    this.active = true;
    this.popTimer = -1;
    this.group.visible = true;
    this.group.scale.setScalar(1);
    this.group.position.set(this.x, this.y, 0.2);
  }

  update(dt: number, time: number): void {
    if (this.popTimer >= 0) {
      this.popTimer += dt;
      const t = Math.min(1, this.popTimer / 0.3);
      this.group.scale.setScalar(1 + 0.8 * (1 - t) * t * 4);
      this.group.position.y = this.y + t * 1.2;
      if (t >= 1) {
        this.group.visible = false;
        this.popTimer = -1;
      }
      return;
    }
    if (!this.active) return;
    this.group.position.y = this.y + Math.sin(time * 3 + this.x) * 0.15;
    this.group.rotation.y = time * 2;
    if (this.ring) {
      this.ring.rotation.y = -time * 2;
      this.ring.scale.setScalar(1 + Math.sin(time * 6) * 0.08);
    }
  }
}
