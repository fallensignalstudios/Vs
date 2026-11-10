/**
 * Authored protagonist handoff (`z.handoff(to)`): a short scene in which the camera glides from the outgoing
 * lead to the incoming one, the bodies change hands on the opening cut, and a "now playing" card names the new
 * lead before control returns. Runs inside `z.cinematic`, so skipping applies exactly the same swap.
 */
import * as THREE from 'three';
import type { CamPose, CineCtx, CompanionMode, HumanoidArchetype, ProtagonistId, Routine, SpeakerId, Vec3Like } from '@/core/api';
import { clamp, DEG } from '@/core/mathx';
import { isStub } from '@/core/stub';
import { pullIn, shotPose } from './cinematic';
import type { ZoneRuntimeImpl } from './runtime';

export interface HandoffOpts {
  partnerMode?: CompanionMode;
  seconds?: number;
  line?: [SpeakerId, string];
}

const LEADS: Record<ProtagonistId, { name: string; faction: string }> = {
  tarrik: { name: 'Tarrik', faction: 'Dominion' },
  selene: { name: 'Selene', faction: 'Reformation' },
};

/**
 * Front three-quarter shot of `subject`: `offsetDeg` to one side of its facing bearing — the side whose camera
 * position is farther from `avoid` (the other lead), so a body standing close by does not fill the foreground.
 */
export function clearShot(subject: Vec3Like, facingDeg: number, offsetDeg: number, avoid: Vec3Like, opts: { distance: number; height: number; fov: number }): CamPose {
  const a = shotPose(subject, { ...opts, yawDeg: facingDeg + offsetDeg });
  const b = shotPose(subject, { ...opts, yawDeg: facingDeg - offsetDeg });
  const da = Math.hypot(a.pos.x - avoid.x, a.pos.z - avoid.z);
  const db = Math.hypot(b.pos.x - avoid.x, b.pos.z - avoid.z);
  return da >= db ? a : b;
}

export function* runHandoff(rt: ZoneRuntimeImpl, to: ProtagonistId, opts?: HandoffOpts): Routine {
  const g = rt.game;
  const from = g.player.protagonist;
  if (to !== 'tarrik' && to !== 'selene') {
    rt.warnOnce(`handoff:${String(to)}`, `handoff to unknown protagonist "${String(to)}" ignored`);
    return;
  }
  if (from === to) {
    rt.log(`handoff to ${to} ignored — already the lead`);
    return;
  }
  const total = clamp(opts?.seconds ?? 3.4, 1.2, 12);
  yield* rt.cinematic(
    `handoff:${from}>${to}`,
    function* (c: CineCtx): Routine {
      const old = rt.livePlayer();
      const oldPos = old ? old.pos.clone() : new THREE.Vector3();
      const oldYaw = old ? old.yaw : 0;
      const partner = rt.cast(to);
      const partnerActor = partner && !isStub(partner) && !isStub(partner.actor) ? partner.actor : null;
      const newPos = partnerActor ? partnerActor.pos.clone() : rt.besideFor(oldPos, oldYaw);
      const newYaw = partnerActor ? partnerActor.yaw : oldYaw;
      if (!partnerActor) rt.warnOnce(`handoff:nobody:${to}`, `handoff to ${to}: no companion body of that name in ${rt.zone.id} — spawning beside the lead`);

      // The swap rides on the cut: the same frame the camera cuts to the outgoing lead, both bodies change hands.
      // Each shot sits on the side of its subject that keeps the other lead out of the lens.
      c.cut(pullIn(g, clearShot(oldPos, -oldYaw / DEG, 28, newPos, { distance: 3.1, height: 1.5, fov: 40 })));
      if (partner) {
        partner.remove();
        rt.uncast(partner);
      }
      g.player.setProtagonist(to, { pos: newPos, yaw: newYaw });
      rt.playerSpawned = true;
      const fromWho: HumanoidArchetype = from === 'selene' ? 'selene' : 'tarrik';
      rt.recast(fromWho, g.ai.spawnCompanion(fromWho, { pos: oldPos, yaw: oldYaw, mode: opts?.partnerMode ?? 'follow' }));
      g.events.emit('handoff', { from, to });

      yield total * 0.16;
      yield* c.move(pullIn(g, clearShot(newPos, -newYaw / DEG, 24, oldPos, { distance: 2.7, height: 1.55, fov: 38 })), total * 0.5, 'inOutCubic');
      if (!c.skipping) g.ui.zoneCard(`Now playing · ${LEADS[to].name}`, LEADS[to].faction);
      if (opts?.line) yield* rt.say(opts.line[0], opts.line[1], { actor: rt.livePlayer() });
      yield total * 0.34;
      g.camera.snapBehind(newYaw);
    },
    { blendOut: 0.9 },
  );
}
