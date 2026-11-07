import { createContext, useContext } from 'react'
import { supabase } from '../lib/supabase'

/** Operations that talk to the server beyond sync. Replaced in tests; null clients mean "no server configured". */
export interface AccountClient {
  /** Permanently deletes the signed-in account and all its data (the database function deletes only the caller). */
  deleteMyAccount(): Promise<{ error: string | null }>
}

export interface FlagRow {
  id: string
  questionId: string
  reason: string
  comment: string | null
  status: 'open' | 'resolved'
  createdAt: string
}

export interface BackupRun {
  id: string
  startedAt: string
  finishedAt: string | null
  status: 'running' | 'success' | 'failed'
  destination: string | null
  sizeBytes: number | null
  verifiedAt: string | null
  errorMessage: string | null
}

export interface AdminClient {
  /** Asks the database; the answer is only used to decide what to show. The database enforces every admin rule itself. */
  isAdmin(): Promise<boolean>
  listFlags(): Promise<{ rows: FlagRow[]; error: string | null }>
  setFlagStatus(id: string, status: 'open' | 'resolved'): Promise<{ error: string | null }>
  listBackups(): Promise<{ rows: BackupRun[]; error: string | null }>
}

export interface ServerClients {
  account: AccountClient | null
  admin: AdminClient | null
}

const msg = (e: unknown) => (e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : 'Something went wrong.')

export function supabaseClients(): ServerClients {
  const sb = supabase
  if (!sb) return { account: null, admin: null }
  return {
    account: {
      async deleteMyAccount() {
        try {
          const { error } = await sb.rpc('delete_my_account')
          return { error: error ? error.message : null }
        } catch (e) {
          return { error: msg(e) }
        }
      },
    },
    admin: {
      async isAdmin() {
        try {
          const { data, error } = await sb.rpc('is_admin')
          return !error && data === true
        } catch {
          return false
        }
      },
      async listFlags() {
        try {
          const { data, error } = await sb.from('flags').select('id,question_id,reason,comment,status,created_at').order('created_at', { ascending: false }).limit(500)
          if (error) return { rows: [], error: error.message }
          return { rows: (data ?? []).map((r) => ({ id: r.id, questionId: r.question_id, reason: r.reason, comment: r.comment, status: r.status === 'resolved' ? 'resolved' as const : 'open' as const, createdAt: r.created_at })), error: null }
        } catch (e) {
          return { rows: [], error: msg(e) }
        }
      },
      async setFlagStatus(id, status) {
        try {
          const { error } = await sb.from('flags').update({ status }).eq('id', id)
          return { error: error ? error.message : null }
        } catch (e) {
          return { error: msg(e) }
        }
      },
      async listBackups() {
        try {
          const { data, error } = await sb.from('backup_runs').select('id,started_at,finished_at,status,destination,size_bytes,verified_at,error_message').order('started_at', { ascending: false }).limit(20)
          if (error) return { rows: [], error: error.message }
          return { rows: (data ?? []).map((r) => ({ id: r.id, startedAt: r.started_at, finishedAt: r.finished_at, status: r.status, destination: r.destination, sizeBytes: r.size_bytes, verifiedAt: r.verified_at, errorMessage: r.error_message })), error: null }
        } catch (e) {
          return { rows: [], error: msg(e) }
        }
      },
    },
  }
}

export const ServerClientsContext = createContext<ServerClients>(supabaseClients())
export const useServerClients = () => useContext(ServerClientsContext)
