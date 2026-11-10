/**
 * Camera "feel" layer: trauma-based shake, recoil kick, FOV punch and idle handheld breathing.
 * Produces small additive offsets (camera-local) that the rig applies on top of the resolved pose.
 * Driven by real dt so it keeps moving through hit-stop and slow-motion.
 */
import { DEG, clamp, clamp01 } from '@/core/mathx';
import { noise1 } from './pose';

const SLOTS = 6;
/** shake at full trauma */
const SHAKE_PITCH = 1.3 * DEG;
const SHAKE_YAW = 1.3 * DEG;
const SHAKE_ROLL = 1.9 * DEG;
const SHAKE_SHIFT = 0.06;
const SHAKE_HZ = 17;
/** recoil spring stiffness (rad/s); critically damped */
const KICK_OMEGA = 19;
/** breathing amplitude */
const BREATH_ANGLE = 0.11 * DEG;
const BREATH_SHIFT = 0.006;
/** accessibility: settings.reduceShake scales every motion source down, timings stay identical */
const REDUCE_SHAKE = 0.18;
const REDUCE_KICK = 0.4;
const REDUCE_PUNCH = 0.4;

export class CameraFeel {
  /** additive camera-local rotation (radians) */
  pitch = 0;
  yaw = 0;
  roll = 0;
  /** additive camera-local translation (metres): x right, y up */
  x = 0;
  y = 0;
  /** additive FOV (degrees) */
  fov = 0;
  /** recoil part of pitch/yaw (radians) — included in the aim ray, unlike shake */
  kickPitch = 0;
  kickYaw = 0;

  private readonly amp = new Float32Array(SLOTS);
  private readonly dur = new Float32Array(SLOTS);
  private readonly age = new Float32Array(SLOTS);
  private time = 0;
  private kp = 0;
  private kpv = 0;
  private ky = 0;
  private kyv = 0;
  private punchFrom = 0;
  private punchTo = 0;
  private punchT = 0;
  private punchDur = 0;
  private punchValue = 0;
  private level = 0;

  /** current combined trauma 0..1 (exactly 0 once every shake has run out) */
  get trauma(): number {
    return this.level;
  }

  /** Add a shake event. Several overlap as a root-sum-square, so small hits never stack into chaos. */
  shake(amplitude: number, duration = 0.4): void {
    const a = clamp01(Number.isFinite(amplitude) ? amplitude : 0);
    const d = Number.isFinite(duration) && duration > 0 ? Math.min(duration, 30) : 0.4;
    if (a <= 0) return;
    // Events the new one fully covers (weaker and shorter-lived) are absorbed, so a shake re-issued every
    // frame stays one event; otherwise take a free slot, else replace the weakest remaining event.
    let slot = 0;
    let weakest = Infinity;
    for (let i = 0; i < SLOTS; i++) {
      let left = 0;
      if (this.amp[i] > 0) {
        const remain = 1 - this.age[i] / this.dur[i];
        left = this.amp[i] * remain;
        if (left <= a && this.dur[i] * remain <= d) {
          this.amp[i] = 0;
          left = 0;
        }
      }
      if (left < weakest) {
        weakest = left;
        slot = i;
      }
    }
    if (weakest >= a) return;
    this.amp[slot] = a;
    this.dur[slot] = d;
    this.age[slot] = 0;
  }

  /** Recoil impulse in degrees: springs out to roughly this angle and settles back. */
  kick(pitchDeg: number, yawDeg = 0): void {
    const k = Math.E * KICK_OMEGA * DEG;
    if (Number.isFinite(pitchDeg)) this.kpv += clamp(pitchDeg, -30, 30) * k;
    if (Number.isFinite(yawDeg)) this.kyv += clamp(yawDeg, -30, 30) * k;
  }

  /** Transient FOV change (degrees) that snaps in and eases back over `seconds`. */
  fovPunch(deltaDeg: number, seconds = 0.35): void {
    if (!Number.isFinite(deltaDeg)) return;
    this.punchFrom = this.punchValue;
    this.punchTo = clamp(deltaDeg, -40, 40);
    this.punchT = 0;
    this.punchDur = Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 10) : 0.35;
  }

  /** Stop everything immediately (hard cuts, zone loads). */
  reset(): void {
    this.amp.fill(0);
    this.kp = this.kpv = this.ky = this.kyv = 0;
    this.punchDur = this.punchT = this.punchValue = 0;
    this.level = 0;
    this.pitch = this.yaw = this.roll = this.x = this.y = this.fov = 0;
    this.kickPitch = this.kickYaw = 0;
  }

  /**
   * @param dt real seconds
   * @param reduce settings.reduceShake
   * @param breathing 0..1 amount of idle handheld life (0 = locked off)
   */
  update(dt: number, reduce: boolean, breathing: number): void {
    this.time += dt;
    const t = this.time;

    // --- trauma ---
    let sq = 0;
    for (let i = 0; i < SLOTS; i++) {
      if (this.amp[i] <= 0) continue;
      this.age[i] += dt;
      if (this.age[i] >= this.dur[i]) {
        this.amp[i] = 0;
        continue;
      }
      const left = this.amp[i] * (1 - this.age[i] / this.dur[i]);
      sq += left * left;
    }
    this.level = sq > 0 ? Math.min(1, Math.sqrt(sq)) : 0;
    let pitch = 0;
    let yaw = 0;
    let roll = 0;
    let x = 0;
    let y = 0;
    if (this.level > 0) {
      const s = this.level * Math.sqrt(this.level) * (reduce ? REDUCE_SHAKE : 1);
      const f = t * SHAKE_HZ;
      pitch = noise1(f, 11) * SHAKE_PITCH * s;
      yaw = noise1(f, 23) * SHAKE_YAW * s;
      roll = reduce ? 0 : noise1(f * 0.8, 37) * SHAKE_ROLL * s;
      x = noise1(f * 0.9, 41) * SHAKE_SHIFT * s;
      y = noise1(f * 0.9, 53) * SHAKE_SHIFT * s;
    }

    // --- recoil (exact critically damped step, stable for any dt) ---
    if (this.kp !== 0 || this.kpv !== 0 || this.ky !== 0 || this.kyv !== 0) {
      const e = Math.exp(-KICK_OMEGA * dt);
      const cp = this.kpv + KICK_OMEGA * this.kp;
      this.kp = (this.kp + cp * dt) * e;
      this.kpv = (this.kpv - cp * KICK_OMEGA * dt) * e;
      const cy = this.kyv + KICK_OMEGA * this.ky;
      this.ky = (this.ky + cy * dt) * e;
      this.kyv = (this.kyv - cy * KICK_OMEGA * dt) * e;
      if (Math.abs(this.kp) < 1e-5 && Math.abs(this.kpv) < 1e-4) this.kp = this.kpv = 0;
      if (Math.abs(this.ky) < 1e-5 && Math.abs(this.kyv) < 1e-4) this.ky = this.kyv = 0;
    }
    const kickScale = reduce ? REDUCE_KICK : 1;
    this.kickPitch = this.kp * kickScale;
    this.kickYaw = this.ky * kickScale;

    // --- FOV punch: 18 % attack, eased release ---
    if (this.punchDur > 0) {
      this.punchT += dt;
      const u = this.punchT / this.punchDur;
      if (u >= 1) {
        this.punchDur = 0;
        this.punchValue = 0;
      } else if (u < 0.18) {
        const a = u / 0.18;
        this.punchValue = this.punchFrom + (this.punchTo - this.punchFrom) * (1 - (1 - a) * (1 - a));
      } else {
        const r = (u - 0.18) / 0.82;
        this.punchValue = this.punchTo * (1 - r) * (1 - r);
      }
    }

    // --- breathing: slow, tiny, never fully still ---
    const b = reduce ? 0 : clamp01(breathing);
    if (b > 0) {
      pitch += noise1(t * 0.31, 71) * BREATH_ANGLE * b;
      yaw += noise1(t * 0.27, 83) * BREATH_ANGLE * b;
      x += noise1(t * 0.23, 97) * BREATH_SHIFT * b;
      y += noise1(t * 0.36, 101) * BREATH_SHIFT * b;
    }

    this.pitch = pitch + this.kickPitch;
    this.yaw = yaw + this.kickYaw;
    this.roll = roll;
    this.x = x;
    this.y = y;
    this.fov = this.punchValue * (reduce ? REDUCE_PUNCH : 1);
  }
}
