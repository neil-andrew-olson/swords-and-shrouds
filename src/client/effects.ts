import * as THREE from 'three';

/**
 * Pooled combat particles (sparks, blood, dust, embers).
 *
 * Everything is instanced: three InstancedMeshes total no matter how much combat is
 * happening, no per-frame allocations (flat typed arrays, swap-remove compaction) and
 * a hard cap per pool so the frame budget stays predictable. The caller passes a
 * reusable vector (no cloning inside the hot path).
 */

export type SparkKind = 'metal' | 'flesh' | 'undead';

const MAX_DT = 0.1;

class ParticlePool {
  readonly mesh: THREE.InstancedMesh;
  private readonly capacity: number;
  private alive = 0;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly size0: Float32Array;
  private readonly size1: Float32Array;
  private readonly gravity: Float32Array;
  private readonly drag: Float32Array;
  private readonly rot: Float32Array;
  private readonly col: Float32Array;
  private readonly aspect: THREE.Vector3;
  private readonly fade: boolean;
  private readonly bounce: boolean;
  private readonly dummy = new THREE.Object3D();
  private readonly color = new THREE.Color();

  constructor(
    scene: THREE.Scene,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    capacity: number,
    aspect: THREE.Vector3,
    fade: boolean,
    bounce = false
  ) {
    this.capacity = capacity;
    this.aspect = aspect;
    this.fade = fade;
    this.bounce = bounce;
    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.size0 = new Float32Array(capacity);
    this.size1 = new Float32Array(capacity);
    this.gravity = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);
    this.rot = new Float32Array(capacity);
    this.col = new Float32Array(capacity * 3);
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    scene.add(this.mesh);
  }

  emit(
    x: number, y: number, z: number,
    vx: number, vy: number, vz: number,
    life: number, size0: number, size1: number,
    gravity: number, drag: number,
    r: number, g: number, b: number
  ) {
    if (this.alive >= this.capacity) return;
    const i = this.alive++;
    const p3 = i * 3;
    this.pos[p3] = x; this.pos[p3 + 1] = y; this.pos[p3 + 2] = z;
    this.vel[p3] = vx; this.vel[p3 + 1] = vy; this.vel[p3 + 2] = vz;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.size0[i] = size0;
    this.size1[i] = size1;
    this.gravity[i] = gravity;
    this.drag[i] = drag;
    this.rot[i] = Math.random() * Math.PI * 2;
    this.col[p3] = r; this.col[p3 + 1] = g; this.col[p3 + 2] = b;
  }

  update(dt: number) {
    const {pos, vel, life, maxLife, size0, size1, gravity, drag, rot, col} = this;
    for (let i = 0; i < this.alive; ) {
      life[i] -= dt;
      if (life[i] <= 0) {
        // Swap-remove: keep the live particles packed at the front.
        this.alive--;
        const last = this.alive;
        if (i !== last) this.copy(last, i);
        continue;
      }
      const p3 = i * 3;
      const damp = 1 - Math.min(0.95, drag[i] * dt);
      vel[p3] *= damp;
      vel[p3 + 2] *= damp;
      vel[p3 + 1] += gravity[i] * dt;
      pos[p3] += vel[p3] * dt;
      pos[p3 + 1] += vel[p3 + 1] * dt;
      pos[p3 + 2] += vel[p3 + 2] * dt;
      if (this.bounce && pos[p3 + 1] < 0.05) {
        pos[p3 + 1] = 0.05;
        vel[p3] = 0; vel[p3 + 1] = 0; vel[p3 + 2] = 0;
        gravity[i] = 0;
      }
      i++;
    }

    const mesh = this.mesh;
    mesh.count = this.alive;
    mesh.visible = this.alive > 0;
    if (this.alive === 0) return;
    for (let i = 0; i < this.alive; i++) {
      const p3 = i * 3;
      const t = 1 - Math.max(0, life[i]) / Math.max(0.0001, maxLife[i]);
      const size = size0[i] + (size1[i] - size0[i]) * t;
      this.dummy.position.set(pos[p3], pos[p3 + 1], pos[p3 + 2]);
      this.dummy.rotation.set(0, rot[i], 0);
      this.dummy.scale.set(size * this.aspect.x, size * this.aspect.y, size * this.aspect.z);
      this.dummy.updateMatrix();
      mesh.setMatrixAt(i, this.dummy.matrix);
      const fade = this.fade ? 1 - t : 1;
      mesh.setColorAt(i, this.color.setRGB(col[p3] * fade, col[p3 + 1] * fade, col[p3 + 2] * fade));
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  private copy(from: number, to: number) {
    const f3 = from * 3;
    const t3 = to * 3;
    this.pos[t3] = this.pos[f3]; this.pos[t3 + 1] = this.pos[f3 + 1]; this.pos[t3 + 2] = this.pos[f3 + 2];
    this.vel[t3] = this.vel[f3]; this.vel[t3 + 1] = this.vel[f3 + 1]; this.vel[t3 + 2] = this.vel[f3 + 2];
    this.col[t3] = this.col[f3]; this.col[t3 + 1] = this.col[f3 + 1]; this.col[t3 + 2] = this.col[f3 + 2];
    this.life[to] = this.life[from];
    this.maxLife[to] = this.maxLife[from];
    this.size0[to] = this.size0[from];
    this.size1[to] = this.size1[from];
    this.gravity[to] = this.gravity[from];
    this.drag[to] = this.drag[from];
    this.rot[to] = this.rot[from];
  }

  get active() { return this.alive; }
}

/** World-space third-person swing trail arcs (pooled instanced ring sectors). */
class SwingTrailPool {
  private readonly mesh: THREE.InstancedMesh;
  private readonly capacity: number;
  private alive = 0;
  private readonly x: Float32Array;
  private readonly z: Float32Array;
  private readonly yaw: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly size: Float32Array;
  private readonly col: Float32Array;
  private readonly dummy = new THREE.Object3D();
  private readonly color = new THREE.Color();

  constructor(scene: THREE.Scene, capacity = 14) {
    this.capacity = capacity;
    const geo = new THREE.RingGeometry(0.42, 1, 20, 1, -0.35, 1.75);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, capacity);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 8;
    this.x = new Float32Array(capacity);
    this.z = new Float32Array(capacity);
    this.yaw = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.size = new Float32Array(capacity);
    this.col = new Float32Array(capacity * 3);
    scene.add(this.mesh);
  }

  emit(x: number, z: number, yaw: number, size: number, r: number, g: number, b: number) {
    if (this.alive >= this.capacity) return;
    const i = this.alive++;
    this.x[i] = x; this.z[i] = z; this.yaw[i] = yaw;
    this.life[i] = 0.22; this.maxLife[i] = 0.22;
    this.size[i] = size;
    const c3 = i * 3;
    this.col[c3] = r; this.col[c3 + 1] = g; this.col[c3 + 2] = b;
  }

  update(dt: number) {
    for (let i = 0; i < this.alive; ) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.alive--;
        const last = this.alive;
        if (i !== last) {
          this.x[i] = this.x[last]; this.z[i] = this.z[last]; this.yaw[i] = this.yaw[last];
          this.life[i] = this.life[last]; this.maxLife[i] = this.maxLife[last]; this.size[i] = this.size[last];
          const f3 = last * 3, t3 = i * 3;
          this.col[t3] = this.col[f3]; this.col[t3 + 1] = this.col[f3 + 1]; this.col[t3 + 2] = this.col[f3 + 2];
        }
        continue;
      }
      i++;
    }
    this.mesh.count = this.alive;
    this.mesh.visible = this.alive > 0;
    if (this.alive === 0) return;
    for (let i = 0; i < this.alive; i++) {
      const t = 1 - this.life[i] / this.maxLife[i];
      const grow = 0.85 + t * 0.35;
      const fade = (1 - t) * (1 - t);
      this.dummy.position.set(this.x[i], 1.25, this.z[i]);
      this.dummy.rotation.set(0, Math.PI - this.yaw[i], 0);
      this.dummy.scale.setScalar(this.size[i] * grow);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
      const c3 = i * 3;
      this.mesh.setColorAt(i, this.color.setRGB(this.col[c3] * fade, this.col[c3 + 1] * fade, this.col[c3 + 2] * fade));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

/** Long-lived pooled ground splatter decals (blood red / corruption violet), cap 32. */
class GroundDecals {
  private readonly mesh: THREE.InstancedMesh;
  private readonly capacity: number;
  private readonly x: Float32Array;
  private readonly z: Float32Array;
  private readonly yaw: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly size: Float32Array;
  private readonly col: Float32Array;
  private next = 0;
  private readonly dummy = new THREE.Object3D();
  private readonly color = new THREE.Color();

  constructor(scene: THREE.Scene, capacity = 32) {
    this.capacity = capacity;
    // Soft procedural splatter (no external asset): white alpha mask tinted per decal.
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, 128, 128);
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 16; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.pow(Math.random(), 0.7) * 42;
      const cx = 64 + Math.cos(a) * r;
      const cy = 64 + Math.sin(a) * r;
      const rad = 7 + Math.random() * 22;
      const grad = ctx.createRadialGradient(cx, cy, rad * 0.15, cx, cy, rad);
      grad.addColorStop(0, 'rgba(255,255,255,0.95)');
      grad.addColorStop(0.65, 'rgba(255,255,255,0.55)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, rad, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let i = 0; i < 26; i++) {
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath();
      ctx.arc(64 + (Math.random() - 0.5) * 110, 64 + (Math.random() - 0.5) * 110, 1 + Math.random() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      map: tex,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, capacity);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.x = new Float32Array(capacity);
    this.z = new Float32Array(capacity);
    this.yaw = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.size = new Float32Array(capacity);
    this.col = new Float32Array(capacity * 3);
    scene.add(this.mesh);
  }

  emit(x: number, z: number, corruption: boolean, amount: number) {
    const i = this.next;
    this.next = (this.next + 1) % this.capacity;
    this.x[i] = x + (Math.random() - 0.5) * 1.1;
    this.z[i] = z + (Math.random() - 0.5) * 1.1;
    this.yaw[i] = Math.random() * Math.PI * 2;
    this.maxLife[i] = 9 + Math.random() * 7;
    this.life[i] = this.maxLife[i];
    this.size[i] = (0.85 + Math.random() * 0.75) * Math.min(2, amount);
    const c3 = i * 3;
    if (corruption) { this.col[c3] = 0.2; this.col[c3 + 1] = 0.028; this.col[c3 + 2] = 0.24; }
    else { this.col[c3] = 0.24; this.col[c3 + 1] = 0.024; this.col[c3 + 2] = 0.028; }
  }

  /** Brief shadow-bolt scorch on the existing decal mesh (no extra draw). */
  emitScorch(x: number, z: number) {
    const i = this.next;
    this.next = (this.next + 1) % this.capacity;
    this.x[i] = x + (Math.random() - 0.5) * 0.4;
    this.z[i] = z + (Math.random() - 0.5) * 0.4;
    this.yaw[i] = Math.random() * Math.PI * 2;
    this.maxLife[i] = 4 + Math.random() * 2.5;
    this.life[i] = this.maxLife[i];
    this.size[i] = 0.75 + Math.random() * 0.6;
    const c3 = i * 3;
    this.col[c3] = 0.2;
    this.col[c3 + 1] = 0.035;
    this.col[c3 + 2] = 0.3;
  }

  update(dt: number) {
    let anyAlive = false;
    for (let i = 0; i < this.capacity; i++) if (this.life[i] > 0) { anyAlive = true; break; }
    this.mesh.visible = anyAlive;
    this.mesh.count = this.capacity;
    for (let i = 0; i < this.capacity; i++) {
      if (this.life[i] > 0) this.life[i] -= dt;
      const alive = this.life[i] > 0;
      let scale = 0;
      if (alive) {
        const fadeStart = 1.5;
        scale = this.size[i] * (this.life[i] < fadeStart ? this.life[i] / fadeStart : 1);
      }
      this.dummy.position.set(this.x[i], 0.055, this.z[i]);
      this.dummy.rotation.set(0, this.yaw[i], 0);
      this.dummy.scale.set(scale, 1, scale);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
      const c3 = i * 3;
      this.mesh.setColorAt(i, this.color.setRGB(this.col[c3], this.col[c3 + 1], this.col[c3 + 2]));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

export class CombatEffects {
  private readonly sparksPool: ParticlePool;
  private readonly bloodPool: ParticlePool;
  private readonly dustPool: ParticlePool;
  private readonly trails: SwingTrailPool;
  private readonly decals: GroundDecals;
  private readonly smokePool: ParticlePool;
  private readonly motePool: ParticlePool;
  private readonly snowPool: ParticlePool;
  /** Per-tier spawn multiplier (low tier spawns fewer particles). */
  private particleScale = 1;

  constructor(scene: THREE.Scene) {
    const sparkGeo = new THREE.BoxGeometry(1, 1, 1);
    const sparkMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    this.sparksPool = new ParticlePool(scene, sparkGeo, sparkMat, 280, new THREE.Vector3(0.5, 1.9, 0.5), false);

    const bloodGeo = new THREE.IcosahedronGeometry(0.5, 0);
    const bloodMat = new THREE.MeshBasicMaterial({color: 0xffffff, depthWrite: false, transparent: true, opacity: 0.92});
    this.bloodPool = new ParticlePool(scene, bloodGeo, bloodMat, 120, new THREE.Vector3(1, 1, 1), false, true);

    const dustGeo = new THREE.IcosahedronGeometry(0.5, 0);
    const dustMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.24,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    this.dustPool = new ParticlePool(scene, dustGeo, dustMat, 72, new THREE.Vector3(1.6, 1.0, 1.6), true);
    this.trails = new SwingTrailPool(scene);
    this.decals = new GroundDecals(scene);
    const smokeGeo = new THREE.IcosahedronGeometry(0.5, 0);
    const smokeMat = new THREE.MeshBasicMaterial({color: 0xffffff, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false});
    this.smokePool = new ParticlePool(scene, smokeGeo, smokeMat, 56, new THREE.Vector3(1.5, 2.1, 1.5), true);
    const moteGeo = new THREE.IcosahedronGeometry(0.5, 0);
    const moteMat = new THREE.MeshBasicMaterial({color: 0xffffff, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false});
    this.motePool = new ParticlePool(scene, moteGeo, moteMat, 120, new THREE.Vector3(1, 1, 1), true);
    const snowGeo = new THREE.IcosahedronGeometry(0.5, 0);
    const snowMat = new THREE.MeshBasicMaterial({color: 0xffffff, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false});
    this.snowPool = new ParticlePool(scene, snowGeo, snowMat, 140, new THREE.Vector3(1, 1, 1), true);
  }

  /** Quality tier hook: <1 reduces particle spawn counts. */
  setQuality(particleScale: number) {
    this.particleScale = Math.max(0.25, Math.min(1, particleScale));
  }

  /** Third-person swing arc in world space; colour is per combat style. */
  trail(position: THREE.Vector3, yaw: number, reach: number, r: number, g: number, b: number) {
    this.trails.emit(position.x, position.z, yaw, Math.max(0.7, reach * 0.55), r, g, b);
  }

  /** Long-lived ground splatter under a hit/death (blood red or corruption violet). */
  splatter(position: THREE.Vector3, corruption: boolean, amount = 1) {
    const count = Math.round((amount > 1.4 ? 3 : amount > 0.9 ? 2 : 1) * this.particleScale);
    for (let i = 0; i < count; i++) this.decals.emit(position.x, position.z, corruption, amount);
  }

  /** Metallic ring-off / blood spray / spectral wisps on every landed hit. */
  sparks(position: THREE.Vector3, kind: SparkKind = 'metal', tint?: [number, number, number]) {
    const {x, y, z} = position;
    const count = Math.max(2, Math.round((kind === 'undead' ? 15 : 13) * this.particleScale));
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.9 + Math.random() * (kind === 'metal' ? 4.2 : 3);
      let r: number, g: number, b: number;
      if (kind === 'metal') {
        const white = Math.random() < 0.34;
        // >1 channels are intentional: additive HDR sparks catch the bloom threshold.
        r = white ? 1.9 : 1.5; g = white ? 1.8 : 0.95 + Math.random() * 0.4; b = white ? 1.6 : 0.3 + Math.random() * 0.3;
      } else if (kind === 'flesh') {
        r = 1.1 + Math.random() * 0.3; g = 0.12 + Math.random() * 0.16; b = 0.1 + Math.random() * 0.12;
      } else {
        r = 0.44 + Math.random() * 0.25; g = 1.15 + Math.random() * 0.3; b = 0.6 + Math.random() * 0.4;
      }
      if (tint) { r = tint[0] * (0.85 + Math.random() * 0.3); g = tint[1] * (0.85 + Math.random() * 0.3); b = tint[2] * (0.85 + Math.random() * 0.3); }
      this.sparksPool.emit(
        x + (Math.random() - 0.5) * 0.35,
        y + (Math.random() - 0.5) * 0.4,
        z + (Math.random() - 0.5) * 0.35,
        Math.cos(angle) * speed,
        1.1 + Math.random() * (kind === 'undead' ? 2.2 : 4.2),
        Math.sin(angle) * speed,
        kind === 'undead' ? 0.45 + Math.random() * 0.55 : 0.26 + Math.random() * 0.36,
        0.07, 0.014,
        kind === 'undead' ? 2.2 : 13,
        0.7,
        r, g, b
      );
    }
  }

  /** Splash of gore on damage (corruption = violet ichor for plague creatures). */
  blood(position: THREE.Vector3, corruption: boolean, amount = 1) {
    const {x, y, z} = position;
    const count = Math.max(2, Math.min(20, Math.round(10 * amount * this.particleScale)));
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.6 + Math.random() * 2.6;
      const tint = Math.random();
      const r = corruption ? 0.32 + tint * 0.16 : 0.42 + tint * 0.2;
      const g = corruption ? 0.05 + tint * 0.1 : 0.035 + tint * 0.05;
      const b = corruption ? 0.34 + tint * 0.2 : 0.05 + tint * 0.04;
      this.bloodPool.emit(
        x + (Math.random() - 0.5) * 0.4,
        y + (Math.random() - 0.5) * 0.5,
        z + (Math.random() - 0.5) * 0.4,
        Math.cos(angle) * speed,
        1.2 + Math.random() * 3.2,
        Math.sin(angle) * speed,
        0.5 + Math.random() * 0.45,
        0.05 + Math.random() * 0.05,
        0.03,
        16,
        0.2,
        r, g, b
      );
    }
  }

  /** Ground dust kicked up by running actors or siege impacts. */
  /** Shadow-bolt ground scorch (reuses pooled decals, one existing draw). */
  scorch(position: THREE.Vector3) {
    this.decals.emitScorch(position.x, position.z);
  }

  dust(position: THREE.Vector3, intensity: number) {
    const {x, y, z} = position;
    const count = Math.max(2, Math.min(9, Math.round((3 + intensity * 6) * this.particleScale)));
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const lift = 0.05 + Math.random() * 0.2;
      this.dustPool.emit(
        x + (Math.random() - 0.5) * 0.5,
        y + lift,
        z + (Math.random() - 0.5) * 0.5,
        Math.cos(angle) * (0.25 + Math.random() * 0.8),
        0.25 + Math.random() * 0.7,
        Math.sin(angle) * (0.25 + Math.random() * 0.8),
        0.65 + Math.random() * 0.7,
        0.16 + Math.random() * 0.1,
        0.42 + Math.random() * 0.34,
        -0.45,
        0.9,
        0.085 + Math.random() * 0.025,
        0.075 + Math.random() * 0.02,
        0.062 + Math.random() * 0.015
      );
    }
  }

  /** Slow glowing motes drifting up from a nearby fire. */
  embers(position: THREE.Vector3, count = 1) {
    for (let i = 0; i < Math.min(3, count); i++) {
      this.sparksPool.emit(
        position.x + (Math.random() - 0.5) * 0.7,
        position.y + 0.15 + Math.random() * 0.7,
        position.z + (Math.random() - 0.5) * 0.7,
        (Math.random() - 0.5) * 0.5,
        0.5 + Math.random() * 0.8,
        (Math.random() - 0.5) * 0.5,
        0.8 + Math.random() * 1.3,
        0.03 + Math.random() * 0.02,
        0.01,
        0.35,
        0.35,
        1,
        0.52 + Math.random() * 0.25,
        0.16 + Math.random() * 0.12
      );
    }
  }

  update(dt: number) {
    const step = Math.min(MAX_DT, Math.max(0, dt));
    if (step === 0) return;
    this.sparksPool.update(step);
    this.bloodPool.update(step);
    this.dustPool.update(step);
    this.trails.update(step);
    this.decals.update(step);
    this.smokePool.update(step);
    this.motePool.update(step);
    this.snowPool.update(step);
    this.smokePool.update(step);
    this.motePool.update(step);
  }

  /** Slow torch-smoke wisp above a fire (additive pale haze, grows and fades). */
  smoke(position: THREE.Vector3) {
    const count = this.particleScale < 0.6 ? 1 : 2;
    for (let i = 0; i < count; i++) {
      this.smokePool.emit(
        position.x + (Math.random() - 0.5) * 0.35,
        position.y + Math.random() * 0.35,
        position.z + (Math.random() - 0.5) * 0.35,
        (Math.random() - 0.5) * 0.22,
        0.32 + Math.random() * 0.35,
        (Math.random() - 0.5) * 0.22,
        1.8 + Math.random() * 1.4,
        0.24 + Math.random() * 0.1,
        1.05 + Math.random() * 0.55,
        0.06, 0.9,
        0.1, 0.105, 0.12
      );
    }
  }
  /** Drifting ash fleck off a fire (slow, dim ember that falls). */
  ash(position: THREE.Vector3) {
    if (this.particleScale < 0.6) return;
    this.sparksPool.emit(
      position.x + (Math.random() - 0.5) * 0.8,
      position.y + Math.random() * 0.6,
      position.z + (Math.random() - 0.5) * 0.8,
      (Math.random() - 0.5) * 0.7,
      0.2 + Math.random() * 0.5,
      (Math.random() - 0.5) * 0.7,
      2.4 + Math.random() * 2.1,
      0.022, 0.008,
      -0.22, 0.55,
      0.8 + Math.random() * 0.25, 0.4 + Math.random() * 0.15, 0.16 + Math.random() * 0.1
    );
  }
  /** Subtle moon-dust motes floating near the camera. */
  motes(position: THREE.Vector3) {
    if (this.particleScale < 0.6) return;
    for (let i = 0; i < 2; i++) {
      this.motePool.emit(
        position.x + (Math.random() - 0.5) * 2,
        position.y + (Math.random() - 0.5) * 1.4,
        position.z + (Math.random() - 0.5) * 2,
        (Math.random() - 0.5) * 0.12,
        0.02 + Math.random() * 0.08,
        (Math.random() - 0.5) * 0.12,
        3.6 + Math.random() * 3,
        0.022, 0.006,
        0.012, 0.25,
        0.42, 0.52, 0.72
      );
    }
  }
  /** Region precipitation: snow flake (Frozen Crown) or drifting ash fleck (Ashen Moor). */
  flake(position: THREE.Vector3, r: number, g: number, b: number, scale: number) {
    if (this.particleScale < 0.6) return;
    this.snowPool.emit(
      position.x + (Math.random() - 0.5) * 18,
      position.y + Math.random() * 5,
      position.z + (Math.random() - 0.5) * 18,
      (Math.random() - 0.5) * 0.5,
      -0.35 - Math.random() * 0.5,
      (Math.random() - 0.5) * 0.5,
      3.5 + Math.random() * 3.5,
      0.028 * scale, 0.024 * scale,
      0.02,
      0.25,
      r, g, b
    );
  }
  /** Live particle count, exposed for the perf HUD / QA reporting. */
  get active() {
    return this.sparksPool.active + this.bloodPool.active + this.dustPool.active;
  }
}
