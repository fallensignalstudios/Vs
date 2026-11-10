/**
 * Objective line, objective / optional world markers and navigation assistance.
 * Nav assist (settings.navAssist): when the straight walk to the objective is blocked, a second, unlabelled
 * objective marker is placed on the next corner of the nav path, refreshed at most twice a second.
 */
import * as THREE from 'three';
import type { Game, Vec3Like } from '@/core/api';
import { isStub } from '@/core/stub';

const NAV_INTERVAL = 0.5;
/** nearer than this the waypoint is not worth showing */
const WAYPOINT_MIN_DIST = 3;
const OBJECTIVE_ID = 'objective';
const WAYPOINT_ID = 'objective:via';

/**
 * Pick the intermediate waypoint to show for a nav path: the first corner that is at least `minDist` from the
 * start, never the goal itself. null when the path is direct.
 */
export function pickWaypoint(points: readonly Vec3Like[], minDist = WAYPOINT_MIN_DIST): Vec3Like | null {
  if (points.length < 3) return null;
  const a = points[0];
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i];
    if (Math.hypot(p.x - a.x, p.z - a.z) >= minDist) return p;
  }
  return null;
}

export class Guidance {
  text: string | null = null;
  marker: THREE.Vector3 | null = null;
  private navTimer = 0;
  private waypointShown = false;
  private readonly optional = new Set<string>();
  private readonly way = new THREE.Vector3();

  constructor(private readonly game: Game) {}

  setObjective(text: string | null, at: THREE.Vector3 | null): void {
    const { ui, events } = this.game;
    this.text = text && text.length ? text : null;
    this.marker = this.text && at ? at.clone() : null;
    if (this.marker) ui.marker(OBJECTIVE_ID, this.marker, { kind: 'objective', hideWithin: 2 });
    else ui.marker(OBJECTIVE_ID, null);
    this.hideWaypoint();
    this.navTimer = 0;
    events.emit('objective:changed', { text: this.text, marker: this.marker });
  }

  setOptional(id: string, at: THREE.Vector3 | null, label?: string): void {
    const key = `optional:${id}`;
    if (at) {
      this.optional.add(key);
      this.game.ui.marker(key, at.clone(), { kind: 'optional', label: label ?? id, hideWithin: 2 });
    } else {
      this.optional.delete(key);
      this.game.ui.marker(key, null);
    }
  }

  update(dt: number): void {
    this.navTimer -= dt;
    if (this.navTimer > 0) return;
    this.navTimer = NAV_INTERVAL;
    const { settings, player, physics, ui } = this.game;
    const target = this.marker;
    const actor = isStub(player) ? null : player.actor;
    if (!target || !actor || isStub(actor) || settings.get('navAssist') !== true || isStub(physics)) {
      this.hideWaypoint();
      return;
    }
    const nav = physics.nav;
    const from = actor.pos;
    if (Math.hypot(target.x - from.x, target.z - from.z) < WAYPOINT_MIN_DIST * 2 || nav.walkable(from, target) === true) {
      this.hideWaypoint();
      return;
    }
    const path = nav.findPath(from, target);
    const wp = path && Array.isArray(path.points) ? pickWaypoint(path.points) : null;
    if (!wp) {
      this.hideWaypoint();
      return;
    }
    this.way.set(wp.x, wp.y + 0.2, wp.z);
    this.waypointShown = true;
    ui.marker(WAYPOINT_ID, this.way, { kind: 'objective', hideWithin: 1.5 });
  }

  dispose(): void {
    const { ui } = this.game;
    ui.marker(OBJECTIVE_ID, null);
    this.hideWaypoint();
    for (const key of this.optional) ui.marker(key, null);
    this.optional.clear();
    this.text = null;
    this.marker = null;
  }

  private hideWaypoint(): void {
    if (!this.waypointShown) return;
    this.waypointShown = false;
    this.game.ui.marker(WAYPOINT_ID, null);
  }
}
