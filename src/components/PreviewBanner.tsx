/**
 * Shown only on builds made for the temporary preview (VITE_PREVIEW=1). It makes it impossible to
 * mistake the test site for the finished product, and it asks people to use test data only.
 */
export default function PreviewBanner() {
  if (import.meta.env.VITE_PREVIEW !== '1') return null
  return (
    <div role="note" className="border-b border-accent bg-surface px-4 py-2 text-center text-sm">
      <strong>PREVIEW build for testing.</strong> Use a test account only. Nothing here is permanent and accounts may be deleted.
    </div>
  )
}
