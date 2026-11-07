import type { Attempt } from './attempts'
import type { PracticeContext } from './session'
import { buildSchedule, dueQuestions } from './srs'
import type { UserData } from '../userdata/model'

/** The bookmark and revision-due sets a session needs, from the student's own data. */
export function practiceContext(history: readonly Attempt[], data: UserData, now: Date = new Date()): PracticeContext {
  return {
    bookmarkedIds: new Set(data.bookmarks.map((b) => b.questionId)),
    dueIds: new Set(dueQuestions(buildSchedule(history), now).map((d) => d.questionId)),
  }
}
