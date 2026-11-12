/**
 * Pointer-lock ownership for the input system: request / release, graceful denial (sandboxed iframes), retry
 * back-off, and handing the cursor back to menus. Never throws; every DOM call is guarded.
 */

/** consecutive denials before canvas clicks stop retrying (a sandboxed iframe will never grant the lock) */
const MAX_STRIKES = 3;
/** seconds after a denial before a click may try again */
const RETRY_COOLDOWN = 1.5;
/** a request that neither resolves nor errors (old engines) stops blocking new ones after this long */
const PENDING_TIMEOUT = 1.5;
/** one strike is forgiven per this many seconds, so a later click gets another chance */
const STRIKE_DECAY = 30;

export interface LockCanvas {
  requestPointerLock?: (opts?: { unadjustedMovement?: boolean }) => unknown;
}
export interface LockDoc {
  readonly pointerLockElement?: unknown;
  exitPointerLock?: () => void;
}

export class PointerLock {
  /** the canvas currently holds the pointer */
  locked = false;
  /** the last request was refused (or the API is missing): the input system is in drag-look mode */
  denied = false;
  /**
   * (ship) the lock is not to be had here: the API is missing, or a request the player made (a canvas click,
   * not a quiet re-lock after a menu) threw, was rejected or got 'pointerlockerror' — typically a sandboxed
   * iframe. Sticky until a lock is actually acquired. Drives the one-line drag-look hint.
   */
  unavailable = false;

  private pending = false;
  private pendingLeft = 0;
  /** a soft request (programmatic re-lock) is never held against the player's clicks */
  private soft = false;
  private strikes = 0;
  private cooldown = 0;
  private decay = 0;
  /** the lock was given up for a menu and should be taken back when play resumes */
  private resume = false;

  constructor(
    private readonly canvas: LockCanvas | null,
    private readonly doc: LockDoc | null,
    private readonly onAcquire: () => void,
  ) {
    if (canvas && typeof canvas.requestPointerLock !== 'function') {
      this.denied = true;
      this.unavailable = true;
      this.strikes = MAX_STRIKES;
    }
  }

  /** may a canvas click try to capture the pointer right now? */
  get canAutoLock(): boolean {
    if (this.pending || !this.canvas || typeof this.canvas.requestPointerLock !== 'function') return false;
    if (!this.denied) return true;
    return this.strikes < MAX_STRIKES && this.cooldown <= 0;
  }

  request(soft = false): void {
    const { canvas, doc } = this;
    if (!canvas || !doc || typeof canvas.requestPointerLock !== 'function') {
      this.denied = true;
      if (canvas) this.unavailable = true;
      return;
    }
    if (this.locked || this.pending) return;
    this.pending = true;
    this.soft = soft;
    this.pendingLeft = PENDING_TIMEOUT;
    this.attempt(true);
  }

  /** `keepResume`: the caller is a menu handing the cursor back — play still takes the lock again afterwards */
  exit(keepResume = false): void {
    this.pending = false;
    if (!keepResume) this.resume = false;
    this.release();
  }

  /** Leaving play for a menu: the cursor goes back to the page, and `restore()` will ask for it again. */
  suspend(): void {
    if (!this.locked) return;
    this.resume = true;
    this.pending = false;
    this.release();
  }

  /** Back in play: quietly re-take a lock that `suspend()` gave up (browsers allow this without a new click). */
  restore(): void {
    if (!this.resume) return;
    this.resume = false;
    if (!this.locked) this.request(true);
  }

  update(dt: number): void {
    if (this.cooldown > 0) this.cooldown -= dt;
    if (this.pending && (this.pendingLeft -= dt) <= 0) this.pending = false;
    if (this.strikes > 0 && typeof this.canvas?.requestPointerLock === 'function') {
      this.decay += dt;
      if (this.decay >= STRIKE_DECAY) {
        this.decay = 0;
        this.strikes--;
      }
    } else this.decay = 0;
  }

  /** document 'pointerlockchange' */
  onChange(): void {
    const { doc, canvas } = this;
    const now = !!doc && !!canvas && doc.pointerLockElement === canvas;
    if (now && !this.locked) {
      this.denied = false;
      this.unavailable = false;
      this.strikes = 0;
      this.onAcquire();
    }
    if (now) this.pending = false;
    this.locked = now;
  }

  /** document 'pointerlockerror' or a rejected request promise (both may report the same denial) */
  onDenied(): void {
    if (!this.pending) return;
    this.pending = false;
    this.denied = true;
    if (this.soft) return;
    this.unavailable = true;
    this.strikes++;
    this.cooldown = RETRY_COOLDOWN;
  }

  private release(): void {
    const doc = this.doc;
    if (!doc || !this.locked || typeof doc.exitPointerLock !== 'function') return;
    try {
      doc.exitPointerLock();
    } catch {
      /* nothing to release */
    }
  }

  private attempt(raw: boolean): void {
    const canvas = this.canvas;
    if (!canvas || typeof canvas.requestPointerLock !== 'function') return;
    try {
      const p = raw ? canvas.requestPointerLock({ unadjustedMovement: true }) : canvas.requestPointerLock();
      if (p && typeof (p as Promise<unknown>).then === 'function') {
        (p as Promise<unknown>).then(undefined, (err: unknown) => {
          // Raw mouse input is optional: retry once without it before treating this as a denial.
          if (raw && (err as { name?: string } | null)?.name === 'NotSupportedError' && this.pending) this.attempt(false);
          else this.onDenied();
        });
      }
    } catch {
      this.onDenied();
    }
  }
}
