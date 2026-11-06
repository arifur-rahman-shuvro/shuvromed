import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

/** False when the env vars are missing, so the UI can show a clear message instead of crashing. */
export const isSupabaseConfigured = Boolean(url && key)

// Only the public publishable key is ever used in the browser. Row level security protects the data.
export const supabase = isSupabaseConfigured
  ? createClient(url as string, key as string, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null
