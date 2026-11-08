import { resetMockCache } from '../mock/store'
import { deleteIdbDatabase } from '../workspace/store/idb'
import { resetAttemptCache } from '../practice/attempts'
import { resetUserDataCache } from '../userdata/store'

/** Removes everything ShuvroMed keeps on this device for one user (answers, bookmarks, notes, exams, preferences). */
export function clearLocalData(userId: string): void {
  try {
    const keys: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.startsWith('shuvromed.') && k.endsWith(`.${userId}`)) keys.push(k)
    }
    keys.forEach((k) => localStorage.removeItem(k))
  } catch {
    /* storage unavailable: nothing to clear */
  }
  void deleteIdbDatabase(userId).catch(() => undefined) // the private workspace kept on this device
  resetAttemptCache()
  resetUserDataCache()
  resetMockCache()
}
