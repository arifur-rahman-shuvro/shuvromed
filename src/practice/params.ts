import { DIFFICULTIES, type Difficulty } from '../content/schema'
import { DEFAULT_CONFIG, clampCount, type PracticeConfig, type PracticeMode } from './session'

const MODES: PracticeMode[] = ['all', 'incorrect', 'unattempted']

/** Practice settings live in the URL so a refresh or a shared link restores the same session. */
export function configToParams(cfg: PracticeConfig, seed?: string): URLSearchParams {
  const p = new URLSearchParams()
  if (cfg.subjectId) p.set('subject', cfg.subjectId)
  if (cfg.topicId) p.set('topic', cfg.topicId)
  if (cfg.examStyle) p.set('style', cfg.examStyle)
  if (cfg.difficulty) p.set('difficulty', cfg.difficulty)
  p.set('count', String(clampCount(cfg.count)))
  p.set('mode', cfg.mode)
  p.set('timed', cfg.timed ? '1' : '0')
  p.set('shuffleq', cfg.shuffleQuestions ? '1' : '0')
  p.set('shuffleo', cfg.shuffleOptions ? '1' : '0')
  if (seed) p.set('seed', seed)
  return p
}

const flag = (v: string | null, fallback: boolean) => (v === '1' ? true : v === '0' ? false : fallback)

/** Anything unknown or malformed falls back to a safe default; the URL is untrusted input. */
export function paramsToConfig(p: URLSearchParams): PracticeConfig {
  const difficulty = p.get('difficulty')
  const mode = p.get('mode')
  const count = Number(p.get('count'))
  return {
    subjectId: p.get('subject') || null,
    topicId: p.get('topic') || null,
    examStyle: p.get('style') || null,
    difficulty: (DIFFICULTIES as readonly string[]).includes(difficulty ?? '') ? (difficulty as Difficulty) : null,
    count: p.get('count') === null ? DEFAULT_CONFIG.count : clampCount(count),
    mode: MODES.includes(mode as PracticeMode) ? (mode as PracticeMode) : DEFAULT_CONFIG.mode,
    timed: flag(p.get('timed'), DEFAULT_CONFIG.timed),
    shuffleQuestions: flag(p.get('shuffleq'), DEFAULT_CONFIG.shuffleQuestions),
    shuffleOptions: flag(p.get('shuffleo'), DEFAULT_CONFIG.shuffleOptions),
  }
}

export function newSeed(): string {
  return Math.random().toString(36).slice(2, 10)
}
