import { LinkButton, Card } from '../components/ui'

const FEATURES = [
  ['Topic-first practice', 'Study a topic, then practise questions on exactly that topic.'],
  ['Spaced repetition', 'Wrong or low-confidence answers come back sooner, with transparent rules.'],
  ['Mock exams', 'Timed papers with a custom length and subject mix, and a full review afterwards.'],
  ['Honest analytics', 'See accuracy, weak areas and confidence versus correctness. No exam-result predictions.'],
  ['Works on slow networks', 'Mobile-first and installable, built to keep working with poor connectivity.'],
  ['Free to use', 'No ads and no paid tiers.'],
]

export default function Landing() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <header className="flex items-center justify-between">
        <p className="text-xl font-bold">ShuvroMed</p>
        <div className="flex gap-2">
          <LinkButton to="/login" variant="secondary">
            Sign in
          </LinkButton>
        </div>
      </header>

      <section className="py-16 text-center">
        <h1 className="text-4xl font-extrabold tracking-tight md:text-5xl">
          Learn the topic. Then practise it.
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-lg text-muted">
          A free, mobile-first medical question bank with spaced repetition, mock exams and progress
          tracking, for MBBS, MRCS, USMLE, UKMLA and PLAB-style study.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <LinkButton to="/signup">Create free account</LinkButton>
          <LinkButton to="/login" variant="secondary">
            Sign in
          </LinkButton>
        </div>
      </section>

      <section aria-labelledby="features" className="grid gap-4 md:grid-cols-3">
        <h2 id="features" className="sr-only">
          Features
        </h2>
        {FEATURES.map(([title, body]) => (
          <Card key={title}>
            <h3 className="font-semibold">{title}</h3>
            <p className="mt-1 text-muted">{body}</p>
          </Card>
        ))}
      </section>

      <footer className="mt-16 border-t border-line pt-6 text-sm text-muted">
        <p>
          <strong>Educational use only.</strong> ShuvroMed is not medical advice, is not a clinical
          tool, and is not affiliated with any exam body. The question bank is a work in progress and
          is not complete. Do not enter patient-identifiable information.
        </p>
      </footer>
    </div>
  )
}
