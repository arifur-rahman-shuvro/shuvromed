export const PASSWORD_MIN = 8
export const PASSWORD_MAX = 72 // Supabase Auth rejects longer passwords
export const NAME_MAX = 80

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export function validateEmail(value: string): string | null {
  const v = value.trim()
  if (!v) return 'Enter your email address.'
  if (v.length > 254 || !EMAIL_RE.test(v)) return 'Enter a valid email address.'
  return null
}

export function validatePassword(value: string): string | null {
  if (value.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`
  if (value.length > PASSWORD_MAX) return `Use at most ${PASSWORD_MAX} characters.`
  return null
}

export function validateDisplayName(value: string): string | null {
  if (value.trim().length > NAME_MAX) return `Keep your name under ${NAME_MAX} characters.`
  return null
}
