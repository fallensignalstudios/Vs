/** The SFX registry: every id the AudioSystem can play. */
import type { RecipeTable } from './recipe';
import { FEEDBACK_SFX, UI_SFX } from './ui';
import { MOVEMENT_SFX } from './movement';
import { TARRIK_SFX } from './tarrik';
import { SELENE_SFX } from './selene';
import { DRONE_SFX, ECLIPSE_SFX, ENFORCER_SFX } from './enemies';
import { DEVICE_SFX, WORLD_SFX } from './world';
import { STORY_SFX } from './story';

export const SFX: RecipeTable = {
  ...UI_SFX,
  ...FEEDBACK_SFX,
  ...MOVEMENT_SFX,
  ...TARRIK_SFX,
  ...SELENE_SFX,
  ...DRONE_SFX,
  ...ENFORCER_SFX,
  ...ECLIPSE_SFX,
  ...DEVICE_SFX,
  ...WORLD_SFX,
  ...STORY_SFX,
};

/** Auditioning groups for the sandbox (and a readable catalogue of what exists). */
export const SFX_GROUPS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['UI', Object.keys(UI_SFX)],
  ['Feedback', Object.keys(FEEDBACK_SFX)],
  ['Movement', Object.keys(MOVEMENT_SFX)],
  ['Tarrik', Object.keys(TARRIK_SFX)],
  ['Selene', Object.keys(SELENE_SFX)],
  ['Drones', Object.keys(DRONE_SFX)],
  ['Enforcers', Object.keys(ENFORCER_SFX)],
  ['Eclipse', Object.keys(ECLIPSE_SFX)],
  ['Devices', Object.keys(DEVICE_SFX)],
  ['World', Object.keys(WORLD_SFX)],
  ['Story', Object.keys(STORY_SFX)],
];

export type { Recipe, RecipeTable } from './recipe';
