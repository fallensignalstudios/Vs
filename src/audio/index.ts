/** STUB — replaced by the audio agent. */
import type { AudioSystem, Game } from '@/core/api';
import { nullObject } from '@/core/stub';

export function createAudioSystem(_game: Game): AudioSystem {
  return nullObject<AudioSystem>('audio');
}
