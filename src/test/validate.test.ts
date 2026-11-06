import { describe, expect, it } from 'vitest'
import { buildBundle } from '../content/bundle'
import type { Question } from '../content/schema'
import { validateContent, type ValidContent } from '../content/validate'
import { isStudentVisible } from '../content/visibility'
import { fakeHash, realBundle, realContent, realContentInput, toInput } from './content'

const clone = <T,>(x: T): T => structuredClone(x)

/** Validate a mutated copy of the real content and return the report. */
function check(mutate: (c: ValidContent) => void) {
  const c = clone(realContent())
  mutate(c)
  return validateContent(toInput(c))
}
const first = (c: ValidContent): Question => c.questions[0]
const codes = (r: ReturnType<typeof check>) => r.errors.map((e) => e.code)
const messages = (r: ReturnType<typeof check>) => r.errors.map((e) => e.message).join(' | ')

describe('real shipped content', () => {
  it('validates with zero errors and zero warnings', () => {
    const r = validateContent(realContentInput())
    expect(r.errors).toEqual([])
    expect(r.warnings).toEqual([])
    expect(r.ok).toBe(true)
  })

  it('contains all 15 required subjects, loaded from data', () => {
    const names = realContent().subjects.map((s) => s.name)
    for (const n of [
      'Anatomy', 'Physiology', 'Biochemistry', 'Embryology', 'Histology', 'Pathology', 'Pharmacology',
      'Microbiology', 'Immunology', 'Forensic Medicine', 'Community Medicine', 'Medicine', 'Surgery',
      'Obstetrics & Gynaecology', 'Paediatrics',
    ]) {
      expect(names).toContain(n)
    }
    expect(names).toHaveLength(15)
  })

  it('contains the Anatomy > Heart > Coronary arteries path', () => {
    const c = realContent()
    const coronary = c.topics.find((t) => t.name === 'Coronary arteries')!
    const heart = c.topics.find((t) => t.id === coronary.parentId)!
    const thorax = c.topics.find((t) => t.id === heart.parentId)!
    expect([thorax.name, heart.name, coronary.name]).toEqual(['Thorax', 'Heart', 'Coronary arteries'])
  })

  it('labels every shipped question as DEMO and unreviewed (nothing AI-written is presented as approved)', () => {
    for (const q of realContent().questions) {
      expect(q.isDemo).toBe(true)
      expect(q.unreviewed).toBe(true)
      expect(q.status).not.toBe('published')
      expect(q.references).toEqual([]) // no invented references
    }
  })

  it('has an analysis for every option and a correct option that exists, on every question', () => {
    for (const q of realContent().questions) {
      expect(Object.keys(q.optionAnalysis).sort()).toEqual(q.options.map((o) => o.id).sort())
      expect(q.options.map((o) => o.id)).toContain(q.correctOptionId)
    }
  })
})

describe('validator catches bad data (each rule broken on purpose)', () => {
  it('duplicate question ids', () => {
    const r = check((c) => c.questions.push(clone(first(c))))
    expect(codes(r)).toContain('duplicate-id')
  })

  it('duplicate topic and subject ids', () => {
    expect(codes(check((c) => c.topics.push(clone(c.topics[0]))))).toContain('duplicate-id')
    expect(codes(check((c) => c.subjects.push(clone(c.subjects[0]))))).toContain('duplicate-id')
  })

  it('unknown topic', () => {
    expect(codes(check((c) => { first(c).topicId = 'no-such-topic' }))).toContain('unknown-topic')
  })

  it('unknown subject', () => {
    expect(codes(check((c) => { first(c).subjectId = 'no-such-subject' }))).toContain('unknown-subject')
  })

  it('topic that belongs to a different subject than the question (inconsistent metadata)', () => {
    const r = check((c) => { first(c).subjectId = 'surgery' })
    expect(codes(r)).toContain('topic-subject-mismatch')
  })

  it('unknown format', () => {
    expect(codes(check((c) => { first(c).format = 'essay' }))).toContain('unknown-format')
  })

  it('wrong number of options for the format', () => {
    const r = check((c) => {
      const q = first(c)
      q.options = q.options.slice(0, 4)
      delete q.optionAnalysis.E
      if (q.correctOptionId === 'E') q.correctOptionId = 'A'
    })
    expect(codes(r)).toContain('option-count')
  })

  it('unknown exam style tag', () => {
    expect(codes(check((c) => { first(c).examTags = ['made-up-exam'] }))).toContain('unknown-exam-tag')
  })

  it('missing correct answer / correct answer not among the options', () => {
    const r = check((c) => { first(c).correctOptionId = 'E'; first(c).options = first(c).options.slice(0, 4); delete first(c).optionAnalysis.E })
    expect(r.ok).toBe(false)
    expect(messages(r)).toMatch(/correctOptionId/)
  })

  it('correctOptionId missing entirely', () => {
    const c = clone(realContent())
    const q = clone(c.questions[0]) as Partial<Question>
    delete q.correctOptionId
    const input = toInput(c)
    input.questions[0] = { source: 'q[0]', data: q }
    const r = validateContent(input)
    expect(r.ok).toBe(false)
    expect(messages(r)).toMatch(/correctOptionId/)
  })

  it('missing explanation', () => {
    const r = check((c) => { first(c).explanation = '   ' })
    expect(r.ok).toBe(false)
    expect(messages(r)).toMatch(/explanation/)
  })

  it('option analysis missing for one option', () => {
    const r = check((c) => { delete first(c).optionAnalysis.C })
    expect(r.ok).toBe(false)
    expect(messages(r)).toMatch(/optionAnalysis/)
  })

  it('option analysis for an option that does not exist', () => {
    expect(check((c) => { first(c).optionAnalysis.Z = 'bogus' }).ok).toBe(false)
  })

  it('bad option ids (out of order) and duplicate option text', () => {
    expect(check((c) => { first(c).options[1].id = 'C'; first(c).options[2].id = 'B' }).ok).toBe(false)
    expect(messages(check((c) => { first(c).options[1].text = first(c).options[0].text }))).toMatch(/identical text/)
  })

  it('unreviewed content cannot be published', () => {
    const r = check((c) => { first(c).status = 'published'; first(c).isDemo = false; first(c).unreviewed = true })
    expect(messages(r)).toMatch(/unreviewed cannot be published/)
  })

  it('demo content cannot be published', () => {
    const r = check((c) => { first(c).status = 'published'; first(c).unreviewed = false })
    expect(messages(r)).toMatch(/demo questions cannot be published/)
  })

  it('a published question needs a reference, and a reviewed non-demo one with a reference passes', () => {
    const bad = check((c) => { first(c).status = 'published'; first(c).unreviewed = false; first(c).isDemo = false })
    expect(messages(bad)).toMatch(/at least one reference/)
    const good = check((c) => {
      const q = first(c)
      q.status = 'published'
      q.unreviewed = false
      q.isDemo = false
      q.references = [{ kind: 'textbook', title: 'Example Textbook of Anatomy' }]
    })
    expect(good.errors).toEqual([])
  })

  it('invalid references (no title, unsafe url)', () => {
    const r = check((c) => {
      first(c).references = [
        { kind: 'article', title: '' },
        { kind: 'website', title: 'x', url: 'javascript:alert(1)' },
      ]
    })
    expect(r.ok).toBe(false)
    expect(messages(r)).toMatch(/references/)
  })

  it('unknown fields are rejected, so typos cannot silently drop data', () => {
    const c = clone(realContent())
    const input = toInput(c)
    input.questions[0] = { source: 'q[0]', data: { ...(c.questions[0] as object), correctOptionID: 'A' } }
    const r = validateContent(input)
    expect(r.ok).toBe(false)
    expect(messages(r)).toMatch(/correctOptionID/)
  })

  it('updatedAt before createdAt, and malformed dates', () => {
    expect(check((c) => { first(c).updatedAt = '2020-01-01T00:00:00Z' }).ok).toBe(false)
    expect(check((c) => { first(c).createdAt = 'yesterday' }).ok).toBe(false)
  })

  it('topic with unknown parent, parent in another subject, and parent cycles', () => {
    expect(codes(check((c) => { c.topics[1].parentId = 'ghost-topic' }))).toContain('unknown-parent')
    const other = check((c) => {
      const phys = c.topics.find((t) => t.subjectId === 'physiology')!
      c.topics.find((t) => t.id === 'anatomy-heart')!.parentId = phys.id
    })
    expect(codes(other)).toContain('parent-subject-mismatch')
    const cycle = check((c) => {
      c.topics.find((t) => t.id === 'anatomy-thorax')!.parentId = 'anatomy-coronary-arteries'
    })
    expect(codes(cycle)).toContain('topic-cycle')
  })

  it('a topic that is its own parent is rejected', () => {
    expect(codes(check((c) => { c.topics[0].parentId = c.topics[0].id }))).toContain('topic-cycle')
  })
})

describe('extensibility: new content needs only data', () => {
  it('a brand new subject, topic, exam style and question format validate with no code change', () => {
    const r = check((c) => {
      c.subjects.push({ id: 'neuroscience', name: 'Neuroscience', sortOrder: 5, isActive: true })
      c.topics.push({ id: 'neuro-cranial-nerves', subjectId: 'neuroscience', parentId: null, name: 'Cranial nerves', sortOrder: 1, isActive: true })
      c.examStyles.push({ id: 'amc', name: 'AMC-style' })
      c.formats.push({ id: 'sba-4', name: 'Single best answer (4 options)', minOptions: 4, maxOptions: 4 })
      const q = clone(first(c))
      q.id = 'demo-neuro-001'
      q.subjectId = 'neuroscience'
      q.topicId = 'neuro-cranial-nerves'
      q.format = 'sba-4'
      q.examTags = ['amc', 'mbbs']
      q.options = q.options.slice(0, 4)
      delete q.optionAnalysis.E
      q.correctOptionId = 'A'
      c.questions.push(q)
    })
    expect(r.errors).toEqual([])
    expect(r.ok).toBe(true)
  })

  it('a flexible 3-5 option format accepts 3, 4 and 5 options', () => {
    for (const n of [3, 4, 5]) {
      const r = check((c) => {
        c.formats.push({ id: 'flex', name: 'Flexible', minOptions: 3, maxOptions: 5 })
        const q = first(c)
        q.format = 'flex'
        q.options = q.options.slice(0, n)
        for (const k of ['A', 'B', 'C', 'D', 'E'].slice(n)) delete q.optionAnalysis[k]
        if (!q.options.map((o) => o.id).includes(q.correctOptionId)) q.correctOptionId = 'A'
      })
      expect(r.errors).toEqual([])
    }
  })
})

describe('visibility rule', () => {
  const base = (): Question => clone(realContent().questions[0])

  it('shows demo questions only when demo is allowed, and never archived ones', () => {
    expect(isStudentVisible(base(), { allowDemo: true })).toBe(true)
    expect(isStudentVisible(base(), { allowDemo: false })).toBe(false)
    expect(isStudentVisible({ ...base(), status: 'archived' }, { allowDemo: true })).toBe(false)
  })

  it('hides every non-published or unreviewed non-demo question', () => {
    for (const status of ['draft', 'needs_review', 'approved', 'archived'] as const) {
      expect(isStudentVisible({ ...base(), isDemo: false, unreviewed: false, status }, { allowDemo: true })).toBe(false)
    }
    expect(isStudentVisible({ ...base(), isDemo: false, unreviewed: true, status: 'published' }, { allowDemo: true })).toBe(false)
    expect(isStudentVisible({ ...base(), isDemo: false, unreviewed: false, status: 'published' }, { allowDemo: true })).toBe(true)
  })
})

describe('content bundle', () => {
  it('ships per-subject files with correct counts and a manifest total', () => {
    const b = realBundle()
    expect(b.manifest.totalQuestions).toBe(8)
    expect(Object.keys(b.questionFiles).sort()).toEqual(['anatomy', 'pharmacology', 'physiology'])
    expect(b.manifest.subjects.map((s) => [s.id, s.questionCount, s.file])).toEqual([
      ['anatomy', 4, 'questions/anatomy.json'],
      ['pharmacology', 2, 'questions/pharmacology.json'],
      ['physiology', 2, 'questions/physiology.json'],
    ])
    expect(b.manifest.includesDemo).toBe(true)
  })

  it('ships NO unreviewed or unpublished question when demo is excluded', () => {
    const b = realBundle({ includeDemo: false })
    expect(b.manifest.totalQuestions).toBe(0)
    expect(b.questionFiles).toEqual({})
    expect(b.manifest.includesDemo).toBe(false)
  })

  it('keeps all subjects in the taxonomy even when they have no questions yet', () => {
    expect(realBundle().taxonomy.subjects).toHaveLength(15)
  })

  it('omits inactive subjects, topics and their questions', () => {
    const c = clone(realContent())
    c.topics.find((t) => t.id === 'anatomy-coronary-arteries')!.isActive = false
    c.subjects.find((s) => s.id === 'physiology')!.isActive = false
    const b = buildBundle(c, { includeDemo: true }, fakeHash)
    expect(b.taxonomy.subjects.map((s) => s.id)).not.toContain('physiology')
    expect(b.taxonomy.topics.map((t) => t.id)).not.toContain('anatomy-coronary-arteries')
    expect(Object.keys(b.questionFiles)).toEqual(['anatomy', 'pharmacology'])
    expect(b.questionFiles.anatomy.map((q) => q.topicId)).not.toContain('anatomy-coronary-arteries')
  })

  it('content version is stable for identical content and changes when a question changes', () => {
    const a = realBundle().manifest.contentVersion
    expect(realBundle().manifest.contentVersion).toBe(a)
    const c = clone(realContent())
    c.questions[0].explanation += ' Updated.'
    expect(buildBundle(c, { includeDemo: true }, fakeHash).manifest.contentVersion).not.toBe(a)
  })

  it('sorts subjects by sortOrder', () => {
    const ids = realBundle().taxonomy.subjects.map((s) => s.id)
    expect(ids.slice(0, 3)).toEqual(['anatomy', 'physiology', 'biochemistry'])
  })
})
