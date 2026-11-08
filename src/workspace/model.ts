/** Private workspace: subjects and nested topics (v3.0 Phase 2). Pure helpers, no I/O. */

export interface WSubject {
  id: string
  name: string
  description: string | null
  archived: boolean
  rowVersion: number
}
export interface WTopic {
  id: string
  subjectId: string
  parentId: string | null
  name: string
  archived: boolean
  rowVersion: number
}
export interface TopicNode extends WTopic {
  children: TopicNode[]
  depth: number
}

export const MAX_SUBJECT_NAME = 120
export const MAX_TOPIC_NAME = 160
export const MAX_DESCRIPTION = 500

/** Same rule as the database `norm_name`: trim, collapse spaces, lower case. */
export const normName = (s: string): string => s.trim().replace(/\s+/g, ' ').toLowerCase()
export const cleanName = (s: string): string => s.trim().replace(/\s+/g, ' ')

export function validateName(raw: string, max: number, siblings: { id: string; name: string }[], selfId?: string): string | null {
  const n = cleanName(raw)
  if (!n) return 'Enter a name.'
  if (n.length > max) return `Keep the name to ${max} characters or fewer.`
  if (siblings.some((s) => s.id !== selfId && normName(s.name) === normName(n))) return 'That name is already used here.'
  return null
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true })

/** Topics of one subject as a forest. A topic whose parent is missing is treated as a root, so nothing disappears. */
export function buildTopicTree(topics: WTopic[], subjectId: string, showArchived: boolean): TopicNode[] {
  const mine = topics.filter((t) => t.subjectId === subjectId)
  const ids = new Set(mine.map((t) => t.id))
  const nodes = new Map<string, TopicNode>(mine.map((t) => [t.id, { ...t, children: [], depth: 0 }]))
  const roots: TopicNode[] = []
  for (const n of nodes.values()) {
    const p = n.parentId && ids.has(n.parentId) ? nodes.get(n.parentId) : undefined
    if (p) p.children.push(n)
    else roots.push(n)
  }
  const walk = (list: TopicNode[], depth: number): TopicNode[] => {
    list.sort(byName)
    return list
      .filter((n) => showArchived || !n.archived)
      .map((n) => {
        n.depth = depth
        n.children = walk(n.children, depth + 1)
        return n
      })
  }
  return walk(roots, 0)
}

export function flatten(nodes: TopicNode[]): TopicNode[] {
  return nodes.flatMap((n) => [n, ...flatten(n.children)])
}

export function descendantIds(topics: WTopic[], id: string): Set<string> {
  const out = new Set<string>()
  const stack = [id]
  while (stack.length) {
    const cur = stack.pop() as string
    for (const t of topics) if (t.parentId === cur && !out.has(t.id)) { out.add(t.id); stack.push(t.id) }
  }
  return out
}

/** Where a topic may be moved: any topic of the same subject except itself and its own descendants. */
export function moveTargets(topics: WTopic[], topic: WTopic): WTopic[] {
  const bad = descendantIds(topics, topic.id)
  bad.add(topic.id)
  return topics.filter((t) => t.subjectId === topic.subjectId && !bad.has(t.id) && !t.archived).sort(byName)
}

export function topicPath(topics: WTopic[], id: string): string {
  const parts: string[] = []
  const seen = new Set<string>()
  let cur = topics.find((t) => t.id === id)
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id)
    parts.unshift(cur.name)
    cur = cur.parentId ? topics.find((t) => t.id === cur!.parentId) : undefined
  }
  return parts.join(' › ')
}

export function plural(n: number, one: string, many = one + 's'): string {
  return `${n} ${n === 1 ? one : many}`
}

/** Why a delete is refused, or null when it is allowed. Nothing is ever removed silently. */
export function deleteRefusal(kind: 'subject' | 'topic', counts: { topics?: number; questions: number }): string | null {
  const parts: string[] = []
  if (counts.topics) parts.push(plural(counts.topics, 'topic'))
  if (counts.questions) parts.push(plural(counts.questions, 'question'))
  if (!parts.length) return null
  return `This ${kind} still has ${parts.join(' and ')}. Move or remove them first, or archive the ${kind} to hide it.`
}
