import { applyFilter, buildSearchIndex, type BankFilter } from '../bank/filter'
import type { WQuestion } from '../questions/repo'
import type { WTag } from '../tags/repo'
import type { WTopic } from '../workspace/model'
import { eligibleForSession, pickQuestions } from './select'
import { MAX_SESSION_QUESTIONS, type SessionConfig } from './types'

/** The questions a filter offers for a session, and how many were left out because an edit is still waiting to sync. */
export function candidatesFor(filter: BankFilter, questions: WQuestion[], ctx: { topics: WTopic[]; tags: Pick<WTag, 'id' | 'category'>[] }): { eligible: WQuestion[]; waiting: number } {
  const hits = applyFilter(questions, { ...filter, state: 'active', text: filter.text }, { ...ctx, index: buildSearchIndex(questions) })
  return eligibleForSession(hits)
}

/** Chooses the questions for a new session from a config: how many (never more than exist or 500) and in what order. */
export function chooseForConfig(config: SessionConfig, questions: WQuestion[], ctx: { topics: WTopic[]; tags: Pick<WTag, 'id' | 'category'>[] }) {
  const { eligible, waiting } = candidatesFor(config.filter, questions, ctx)
  const count = Math.min(config.count, eligible.length, MAX_SESSION_QUESTIONS)
  return { picked: pickQuestions(eligible, count, config.seed, config.shuffleQuestions), available: eligible.length, waiting }
}

/** A short plain-words line for a saved exam or session. */
export function describeConfig(c: SessionConfig): string {
  const bits = [`${c.count} question${c.count === 1 ? '' : 's'}`, c.sourceLabel]
  if (c.mode === 'exam') bits.push(c.timeLimitMinutes ? `${c.timeLimitMinutes} min` : 'no time limit')
  if (!c.negativeMarking) bits.push('no negative marking')
  return bits.join(' · ')
}
