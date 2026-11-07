/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string
  /** '1' on the temporary preview build only. */
  readonly VITE_PREVIEW?: string
}
interface ImportMeta {
  readonly env: ImportMetaEnv
}
