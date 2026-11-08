import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fixtures from '../../src/questions/contract-fixtures.json'
import { Tx } from './support/db'

/** The same fixture file the TypeScript schema is tested with must give the same verdict in the database. */
let tx: Tx
beforeAll(async () => { tx = await Tx.open() })
afterAll(async () => { await tx.close() })

describe('database check function agrees with the TypeScript contract', () => {
  for (const c of fixtures.cases) {
    it(`${c.valid ? 'accepts' : 'rejects'}: ${c.name}`, async () => {
      await tx.begin()
      await tx.as('postgres')
      const r = await tx.ok(`select public.valid_question_payload($1, $2, $3::jsonb) as ok`, [c.type, c.stem, JSON.stringify(c.content)])
      await tx.rollback()
      expect(r.rows[0].ok).toBe(c.valid)
    })
  }
})
