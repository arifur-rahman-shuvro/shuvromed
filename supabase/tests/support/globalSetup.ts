import { buildTestDatabase } from './db'

export default async function setup() {
  await buildTestDatabase()
}
