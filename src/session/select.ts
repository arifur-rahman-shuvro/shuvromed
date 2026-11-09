import type { WQuestion } from '../questions/repo'
import { shuffled } from '../questions/registry'

/**
 * Which questions a session may use. Archived and deleted ones never. A question whose edit has not reached the server yet
 * (and that is already on the server) waits: an answer is stamped with the question's server version, and it must be the version
 * the learner actually saw. A question that has never been sent is stamped version 1, which is what it will become.
 */
export function eligibleForSession(list: WQuestion[]): { eligible: WQuestion[]; waiting: number } {
  const eligible: WQuestion[] = []
  let waiting = 0
  for (const q of list) {
    if (q.archived || q.deleted) continue
    if (q.version !== null && q.pendingEdit) { waiting++; continue }
    eligible.push(q)
  }
  return { eligible, waiting }
}

/** The version an answer to this question is stamped with. */
export const versionToStamp = (q: Pick<WQuestion, 'version'>): number => q.version ?? 1

/** Picks `count` questions. Shuffled with the seed (same seed, same pick), or the first ones in the given order. */
export function pickQuestions<T extends { id: string }>(candidates: T[], count: number, seed: number, shuffle: boolean): T[] {
  const list = shuffle ? shuffled(candidates, seed) : candidates
  return list.slice(0, Math.max(0, count))
}
