import { DIFFICULTIES, type Difficulty, type QuestionContent, type QuestionType } from '../questions/schema'
import type { ImportItem, ReadResult } from './types'

/**
 * The paste format (see PROMPT_KIT in kit.ts for the version people copy):
 *
 *   Subject: Anatomy            lines BEFORE a question set defaults for it and every later question
 *   Topic: Heart > Valves
 *   Exam: FCPS Part 1, MBBS
 *   Tags: high yield
 *   Difficulty: hard
 *
 *   Q: Which valve lies between the left atrium and ventricle?
 *   A) Tricuspid
 *   B) Mitral *                 a trailing * marks a correct option   (or write: Answer: B)
 *   C) Aortic
 *   Explanation: ...
 *   Reference: ...
 *   ---                         closes the question
 *
 * True/false:   Q: The heart has four chambers.   then   Answer: True
 * Fill the gap: Q: The [heart|cardiac muscle] pumps blood.      (alternatives separated by |)
 * Inside a question (after Q:), Subject/Topic/Exam/Tags/Difficulty apply to that one question only.
 */
const KEYS: Record<string, string> = {
  subject: 'subject', topic: 'topic', topics: 'topic', exam: 'exam', exams: 'exam', tag: 'tags', tags: 'tags', difficulty: 'difficulty', type: 'type',
  q: 'q', question: 'q', answer: 'answer', ans: 'answer', explanation: 'explanation', exp: 'explanation', reference: 'reference', ref: 'reference', source: 'reference',
}
const OPTION = /^\(?([A-Za-z])[).:]\s+(.*)$/
const KEY_LINE = /^([A-Za-z]+)\s*:\s*(.*)$/

interface Defaults { subject: string; topics: string[][]; exam: string[]; tags: string[]; difficulty: Difficulty | null }
interface Draft extends Defaults {
  startLine: number
  stem: string[]
  options: { letter: string; text: string; marked: boolean }[]
  answer: string | null
  type: string | null
  explanation: string[]
  reference: string[]
  last: 'stem' | 'option' | 'explanation' | 'reference' | 'other'
}

const splitList = (s: string): string[] => s.split(/[,;]/).map((x) => x.trim()).filter(Boolean)
/** "Heart > Valves; Lung" -> [['Heart','Valves'], ['Lung']]. Only a semicolon separates topics, because names may contain commas. */
const splitTopics = (s: string): string[][] => s.split(';').map((p) => p.split(/\s*[>›]\s*/).map((x) => x.trim()).filter(Boolean)).filter((p) => p.length)
const cleanDifficulty = (s: string): Difficulty | null | 'bad' => {
  const v = s.trim().toLowerCase()
  if (!v || v === '-') return null
  return (DIFFICULTIES as readonly string[]).includes(v) ? (v as Difficulty) : 'bad'
}
const typeFrom = (s: string): QuestionType | null => {
  const v = s.trim().toLowerCase().replace(/[\s_-]+/g, '')
  if (['sba', 'single', 'singlebestanswer', 'mcq'].includes(v)) return 'SBA'
  if (['multiple', 'multiplemcq', 'multipleanswer', 'mma', 'mrq'].includes(v)) return 'MULTIPLE_MCQ'
  if (['tf', 'truefalse', 'boolean'].includes(v)) return 'TRUE_FALSE'
  if (['gap', 'fill', 'fillgap', 'fillinthegap', 'fillintheblank', 'blank'].includes(v)) return 'FILL_GAP'
  return null
}

export function readPaste(text: string): ReadResult {
  const out: ReadResult = { items: [], failures: [], fatal: null }
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  if (!lines.some((l) => l.trim())) return { ...out, fatal: 'Paste some questions first.' }
  const defaults: Defaults = { subject: '', topics: [], exam: [], tags: [], difficulty: null }
  let cur: Draft | null = null
  let n = 0
  // Problems found outside any question are reported with their line number.
  const pending: { line: number; text: string }[] = []

  const finish = () => {
    if (!cur) return
    const d = cur
    cur = null
    n++
    const label = `Question ${n} (line ${d.startLine})`
    const r = build(d)
    if ('problems' in r) out.failures.push({ label, problems: r.problems })
    else out.items.push({ label, item: r.item })
  }

  lines.forEach((raw, idx) => {
    const lineNo = idx + 1
    const line = raw.trim()
    if (!line) { if (cur) cur.last = 'other'; return }
    if (/^-{3,}$/.test(line) || /^={3,}$/.test(line)) { finish(); return }
    const m = KEY_LINE.exec(line)
    const key = m ? KEYS[m[1].toLowerCase()] : undefined
    // An option line such as "A) text" is never a key line. "Q:" always starts a new question.
    if (m && key === 'q') {
      finish()
      cur = { ...structuredClone(defaults), startLine: lineNo, stem: [m[2]], options: [], answer: null, type: null, explanation: [], reference: [], last: 'stem' }
      return
    }
    if (m && key && key !== 'q') {
      const value = m[2].trim()
      const target: Defaults | Draft = cur ?? defaults
      if (key === 'subject') { target.subject = value; if (!cur) defaults.topics = [] }
      else if (key === 'topic') target.topics = value === '-' ? [] : splitTopics(value)
      else if (key === 'exam') target.exam = value === '-' ? [] : splitList(value)
      else if (key === 'tags') target.tags = value === '-' ? [] : splitList(value)
      else if (key === 'difficulty') { const dv = cleanDifficulty(value); target.difficulty = dv === 'bad' ? null : dv; if (dv === 'bad') pending.push({ line: lineNo, text: `Difficulty "${value}" is not easy, medium or hard.` }) }
      else if (cur) {
        if (key === 'type') cur.type = value
        else if (key === 'answer') { cur.answer = value; cur.last = 'other' }
        else if (key === 'explanation') { cur.explanation = [value]; cur.last = 'explanation' }
        else if (key === 'reference') { cur.reference = [value]; cur.last = 'reference' }
      } else pending.push({ line: lineNo, text: `"${m[1]}:" must come after a Q: line.` })
      return
    }
    if (!cur) { pending.push({ line: lineNo, text: 'This line is outside any question. Start a question with "Q:".' }); return }
    const o = OPTION.exec(line)
    if (o && cur.last !== 'explanation' && cur.last !== 'reference') {
      let text = o[2].trim()
      let marked = false
      if (/\s?\*\s*$/.test(text) || /\(correct\)\s*$/i.test(text)) { marked = true; text = text.replace(/\s?\*\s*$/, '').replace(/\s*\(correct\)\s*$/i, '').trim() }
      cur.options.push({ letter: o[1].toLowerCase(), text, marked })
      cur.last = 'option'
      return
    }
    // A continuation line joins the part above it.
    if (cur.last === 'option' && cur.options.length) {
      const opt = cur.options[cur.options.length - 1]
      let more = line
      if (/\s?\*\s*$/.test(more) || /\(correct\)\s*$/i.test(more)) { opt.marked = true; more = more.replace(/\s?\*\s*$/, '').replace(/\s*\(correct\)\s*$/i, '').trim() }
      opt.text += ' ' + more
    }
    else if (cur.last === 'explanation') cur.explanation.push(line)
    else if (cur.last === 'reference') cur.reference.push(line)
    else cur.stem.push(line)
  })
  finish()
  for (const p of pending) out.failures.push({ label: `Line ${p.line}`, problems: [p.text] })
  if (!out.items.length && !out.failures.length) out.fatal = 'No questions found. Start each question with "Q:".'
  return out
}

function build(d: Draft): { item: ImportItem } | { problems: string[] } {
  const problems: string[] = []
  let stem = d.stem.join('\n').trim()
  if (!d.subject.trim()) problems.push('No subject. Add a "Subject:" line before the question.')
  let type: QuestionType | null = null
  if (d.type) { type = typeFrom(d.type); if (!type) problems.push(`Type "${d.type}" is not recognised (use SBA, Multiple, TF or Gap).`) }
  const ans = d.answer?.trim() ?? ''
  const isBool = /^(true|false|t|f)$/i.test(ans)
  const gaps = [...stem.matchAll(/\[([^[\]]+)\]/g)]
  if (!type && !problems.length) {
    if (d.options.length) type = d.options.filter((o) => o.marked).length > 1 || (ans && letters(ans, d.options.length).length > 1) ? 'MULTIPLE_MCQ' : 'SBA'
    else if (isBool) type = 'TRUE_FALSE'
    else if (gaps.length) type = 'FILL_GAP'
    else problems.push('Could not tell the type. Add options (A, B, C…), an "Answer: True/False" line, or a [gap] in the question.')
  }
  const base = { subject: d.subject.trim(), topics: d.topics, examTags: d.exam, generalTags: d.tags, difficulty: d.difficulty, explanation: d.explanation.join('\n').trim() || null, reference: d.reference.join('\n').trim() || null }
  let content: QuestionContent | null = null
  if (type === 'SBA' || type === 'MULTIPLE_MCQ') {
    if (d.options.length < 2) problems.push('Add at least 2 options (A, B, …).')
    const ids = d.options.map((o) => o.letter)
    if (new Set(ids).size !== ids.length) problems.push('Two options use the same letter.')
    const fromAnswer = ans ? letters(ans, d.options.length) : []
    const correct = ans ? fromAnswer : d.options.filter((o) => o.marked).map((o) => o.letter)
    if (ans && fromAnswer.some((l) => !ids.includes(l))) problems.push(`Answer "${ans}" does not match the options.`)
    if (!correct.length) problems.push('Mark the correct option with * at the end, or add an "Answer:" line.')
    if (type === 'SBA' && correct.length > 1) problems.push('This is single-answer but more than one option is marked correct. Use "Type: Multiple".')
    if (type === 'MULTIPLE_MCQ' && correct.length < 2) problems.push('Multiple-answer needs at least 2 correct options.')
    const options = d.options.map((o) => ({ id: o.letter, text: o.text }))
    content = type === 'SBA' ? { options, correct_option_id: correct[0] ?? '' } : { options, correct_option_ids: correct }
  } else if (type === 'TRUE_FALSE') {
    if (!isBool) problems.push('Add "Answer: True" or "Answer: False".')
    content = { correct_answer: /^(true|t)$/i.test(ans) }
  } else if (type === 'FILL_GAP') {
    if (!gaps.length) problems.push('Put each missing word in [square brackets], for example "The [heart] pumps blood."')
    const blanks = gaps.map((g, i) => ({ id: `b${i + 1}`, accepted_answers: g[1].split('|').map((x) => x.trim()).filter(Boolean) }))
    let i = 0
    stem = stem.replace(/\[([^[\]]+)\]/g, () => `{{b${++i}}}`)
    content = { blanks }
  }
  if (problems.length || !type || !content) return { problems }
  return { item: { ...base, type, stem, content } }
}

/** "B", "b, d", "A and C", "AC" → ['b'] / ['b','d'] / ['a','c']. */
function letters(s: string, optionCount: number): string[] {
  const parts = s.split(/[\s,;&]+|\band\b/i).filter(Boolean)
  const out: string[] = []
  for (const p of parts) {
    if (/^[A-Za-z]$/.test(p)) out.push(p.toLowerCase())
    else if (/^[A-Za-z]+$/.test(p) && p.length <= optionCount && p === p.toUpperCase()) out.push(...p.toLowerCase().split(''))
    else out.push(p.toLowerCase())
  }
  return [...new Set(out)]
}
