import type { Topic } from './schema'

export interface TopicNode {
  topic: Topic
  depth: number
  children: TopicNode[]
}

const bySort = (a: Topic, b: Topic) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)

/**
 * Builds the topic hierarchy for one subject. A topic whose parent is missing from the
 * list (for example an inactive parent that was filtered out) is promoted to a root, so
 * no question is ever unreachable.
 */
export function buildTopicTree(topics: readonly Topic[], subjectId: string): TopicNode[] {
  const inSubject = topics.filter((t) => t.subjectId === subjectId)
  const ids = new Set(inSubject.map((t) => t.id))
  const childrenOf = new Map<string, Topic[]>()
  const roots: Topic[] = []
  for (const t of inSubject) {
    if (t.parentId && ids.has(t.parentId)) {
      const list = childrenOf.get(t.parentId) ?? []
      list.push(t)
      childrenOf.set(t.parentId, list)
    } else {
      roots.push(t)
    }
  }
  const build = (t: Topic, depth: number, seen: Set<string>): TopicNode => {
    const nextSeen = new Set(seen).add(t.id)
    const kids = (childrenOf.get(t.id) ?? []).filter((c) => !nextSeen.has(c.id)).sort(bySort)
    return { topic: t, depth, children: kids.map((c) => build(c, depth + 1, nextSeen)) }
  }
  return roots.sort(bySort).map((r) => build(r, 0, new Set()))
}

/** The topic itself plus every topic beneath it. */
export function descendantIds(topics: readonly Topic[], topicId: string): Set<string> {
  const out = new Set<string>([topicId])
  let grew = true
  while (grew) {
    grew = false
    for (const t of topics) {
      if (t.parentId && out.has(t.parentId) && !out.has(t.id)) {
        out.add(t.id)
        grew = true
      }
    }
  }
  return out
}

/** Flattens a tree depth-first, keeping order. Handy for <select> lists. */
export function flattenTree(nodes: readonly TopicNode[]): TopicNode[] {
  return nodes.flatMap((n) => [n, ...flattenTree(n.children)])
}
