import { LinkButton } from '../components/ui'

/** Shown for any address the app does not have. Works signed in or out. */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 p-6 text-center">
      <h1 className="text-2xl font-bold">Page not found</h1>
      <p className="text-muted">That address does not exist. The link may be old or mistyped.</p>
      <div className="flex flex-wrap justify-center gap-3">
        <LinkButton to="/app">Go to my dashboard</LinkButton>
        <LinkButton to="/" variant="secondary">Home</LinkButton>
      </div>
    </main>
  )
}
