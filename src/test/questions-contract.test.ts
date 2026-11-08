import { describe, expect, it } from 'vitest'
import fixtures from '../questions/contract-fixtures.json'
import { grade, normalizeAnswer, type QuestionLike } from '../questions/grade'
import { searchText, shuffled, stemPreview } from '../questions/registry'
import { blankMarkers, validateQuestion, type QuestionContent, type QuestionType } from '../questions/schema'

describe('contract fixtures (the database runs the same file)', () => {
  for (const c of fixtures.cases) {
    it(`${c.valid ? 'accepts' : 'rejects'}: ${c.name}`, () => {
      expect(validateQuestion(c.type as QuestionType, c.stem, c.content).ok).toBe(c.valid)
    })
  }
})

describe('validation extras', () => {
  it('cleans text and drops blank option explanations', () => {
    const r = validateQuestion('SBA', '  Q?  ', { options: [{ id: 'a', text: ' Alpha ', explanation: '   ' }, { id: 'b', text: 'Beta' }], correct_option_id: 'a' })
    expect(r.ok && r.stem).toBe('Q?')
    expect(r.ok && JSON.stringify(r.content)).toBe('{"options":[{"id":"a","text":"Alpha"},{"id":"b","text":"Beta"}],"correct_option_id":"a"}')
  })
  it('gives friendly messages with a path', () => {
    const r = validateQuestion('SBA', '', { options: [{ id: 'a', text: 'x' }, { id: 'b', text: 'x' }], correct_option_id: 'zz' })
    expect(r.ok).toBe(false)
    const msgs = !r.ok ? r.problems.map((p) => p.message) : []
    expect(msgs).toEqual(expect.arrayContaining(['Write the question.', 'Two options have the same text.', 'Choose the correct option.']))
  })
  it('flags a blank marker in the stem that has no answers (stricter than the database)', () => {
    const r = validateQuestion('FILL_GAP', 'A {{b1}} and {{b2}}', { blanks: [{ id: 'b1', accepted_answers: ['x'] }] })
    expect(!r.ok && r.problems.some((p) => /"b2"/.test(p.message))).toBe(true)
    expect(blankMarkers('A {{b1}} and {{b2}}')).toEqual(['b1', 'b2'])
  })
})

const sba = (extra = {}): QuestionLike => ({ question_type: 'SBA', stem: 'Q', content: { options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }], correct_option_id: 'a', ...extra } as QuestionContent })
const multi = (scoring?: object): QuestionLike => ({ question_type: 'MULTIPLE_MCQ', stem: 'Q', content: { options: ['a', 'b', 'c', 'd'].map((id) => ({ id, text: id.toUpperCase() })), correct_option_ids: ['a', 'b'], ...(scoring ? { scoring } : {}) } as QuestionContent })
const fill = (extra = {}): QuestionLike => ({ question_type: 'FILL_GAP', stem: '{{b1}} and {{b2}}', content: { blanks: [{ id: 'b1', accepted_answers: ['Heart', 'cor'] }, { id: 'b2', accepted_answers: ['Na+'] }], ...extra } as QuestionContent })

describe('grading: single best answer and true/false', () => {
  it('scores right, wrong, unanswered', () => {
    expect(grade(sba(), { selected: 'a' })).toMatchObject({ score: 1, outcome: 'correct' })
    expect(grade(sba(), { selected: 'b' })).toMatchObject({ score: 0, outcome: 'incorrect' })
    expect(grade(sba(), {})).toMatchObject({ score: 0, outcome: 'unanswered' })
    expect(grade(sba(), null)).toMatchObject({ outcome: 'unanswered' })
  })
  it('applies negative marking only to wrong answers', () => {
    const q = sba({ scoring: { negative_marks: 0.25 } })
    expect(grade(q, { selected: 'b' }).score).toBe(-0.25)
    expect(grade(q, {}).score).toBe(0)
    expect(grade(q, { selected: 'a' }).score).toBe(1)
  })
  it('true/false', () => {
    const tf = (neg?: number): QuestionLike => ({ question_type: 'TRUE_FALSE', stem: 'S', content: { correct_answer: false, ...(neg ? { scoring: { negative_marks: neg } } : {}) } })
    expect(grade(tf(), { value: false })).toMatchObject({ score: 1, outcome: 'correct' })
    expect(grade(tf(0.5), { value: true }).score).toBe(-0.5)
    expect(grade(tf(), { value: 'x' })).toMatchObject({ outcome: 'unanswered' })
  })
})

describe('grading: multiple correct answers', () => {
  it('exact mode needs exactly the right set', () => {
    expect(grade(multi(), { selected: ['b', 'a'] })).toMatchObject({ score: 1, outcome: 'correct' })
    expect(grade(multi(), { selected: ['a'] })).toMatchObject({ score: 0, outcome: 'incorrect' })
    expect(grade(multi(), { selected: ['a', 'b', 'c'] }).score).toBe(0)
    expect(grade(multi({ negative_marks: 0.5 }), { selected: ['a', 'c'] }).score).toBe(-0.5)
    expect(grade(multi(), { selected: [] }).outcome).toBe('unanswered')
  })
  it('partial mode: (right - wrong x weight) / correct, never below 0', () => {
    const p = (w?: number) => multi({ mode: 'partial', ...(w !== undefined ? { penalty_weight: w } : {}) })
    expect(grade(p(), { selected: ['a'] })).toMatchObject({ score: 0.5, outcome: 'partial' })
    expect(grade(p(), { selected: ['a', 'b'] }).score).toBe(1)
    expect(grade(p(), { selected: ['a', 'c'] }).score).toBe(0)
    expect(grade(p(0.5), { selected: ['a', 'b', 'c'] }).score).toBe(0.75)
    expect(grade(p(), { selected: ['c', 'd'] })).toMatchObject({ score: 0, outcome: 'incorrect' })
  })
  it('ignores ids that are not options and repeated ids', () => {
    expect(grade(multi(), { selected: ['a', 'a', 'b', 'zzz'] }).score).toBe(1)
  })
  it('partial mode with negative marks only when nothing earned', () => {
    const q = multi({ mode: 'partial', negative_marks: 0.25 })
    expect(grade(q, { selected: ['c'] }).score).toBe(-0.25)
    expect(grade(q, { selected: ['a'] }).score).toBe(0.5)
  })
})

describe('grading: fill in the gap', () => {
  it('ignores case, extra spaces and unicode forms by default', () => {
    expect(grade(fill(), { answers: { b1: '  HEART ', b2: 'na+' } })).toMatchObject({ score: 1, outcome: 'correct' })
    expect(grade(fill(), { answers: { b1: 'ｈｅａｒｔ', b2: 'Na+' } }).score).toBe(1) // full-width letters fold to plain ones (NFKC)
    expect(grade(fill(), { answers: { b1: 'he  art', b2: 'Na+' } }).score).toBe(0.5)
  })
  it('partial credit per blank, or all-or-nothing', () => {
    expect(grade(fill(), { answers: { b1: 'cor', b2: 'x' } })).toMatchObject({ score: 0.5, outcome: 'partial' })
    expect(grade(fill({ scoring: { mode: 'all_or_nothing' } }), { answers: { b1: 'cor', b2: 'x' } })).toMatchObject({ score: 0, outcome: 'incorrect' })
  })
  it('unanswered when every blank is empty', () => {
    expect(grade(fill(), { answers: { b1: ' ', b2: '' } })).toMatchObject({ score: 0, outcome: 'unanswered' })
  })
  it('case sensitivity: global and per blank', () => {
    const strict = fill({ normalization: { case_sensitive: true } })
    expect(grade(strict, { answers: { b1: 'heart', b2: 'Na+' } }).score).toBe(0.5)
    const one = { question_type: 'FILL_GAP', stem: '{{b1}} {{b2}}', content: { blanks: [{ id: 'b1', accepted_answers: ['DNA'], case_sensitive: true }, { id: 'b2', accepted_answers: ['x'] }] } } as QuestionLike
    expect(grade(one, { answers: { b1: 'dna', b2: 'X' } }).score).toBe(0.5)
  })
  it('optional punctuation removal', () => {
    const q = fill({ normalization: { strip_punctuation: true } })
    expect(grade(q, { answers: { b1: 'heart!', b2: 'na+' } }).score).toBe(1) // '+' is a symbol, not punctuation, so it must still match
    expect(grade(q, { answers: { b1: 'heart!', b2: 'Na' } }).score).toBe(0.5)
    expect(normalizeAnswer('  Hello,   World! ', { stripPunctuation: true })).toBe('hello world')
  })
  it('reports which blanks were right', () => {
    const r = grade(fill(), { answers: { b1: 'heart', b2: 'k' } })
    expect(r.detail.type === 'FILL_GAP' && r.detail.blanks.map((b) => b.ok)).toEqual([true, false])
  })
})

describe('helpers', () => {
  it('search text covers wording, options, answers and explanation', () => {
    const t = searchText({ ...fill(), explanation: 'Because Reasons' })
    expect(t).toContain('heart')
    expect(t).toContain('because reasons')
    expect(t).toContain('___')
  })
  it('stem preview hides markers and shortens', () => {
    expect(stemPreview('The {{b1}} pumps')).toBe('The ____ pumps')
    expect(stemPreview('x'.repeat(300), 20)).toHaveLength(20)
  })
  it('shuffle is deterministic per seed and keeps every item', () => {
    const a = shuffled([1, 2, 3, 4, 5, 6], 42)
    expect(shuffled([1, 2, 3, 4, 5, 6], 42)).toEqual(a)
    expect([...a].sort()).toEqual([1, 2, 3, 4, 5, 6])
    expect(shuffled([1, 2, 3, 4, 5, 6], 43)).not.toEqual(a)
  })
})
