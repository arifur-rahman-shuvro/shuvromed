import { EmptyState } from '../components/ui'

export default function ComingSoon({ title, phase }: { title: string; phase: string }) {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">{title}</h1>
      <EmptyState
        title="Not built yet"
        body={`This section is planned for ${phase}. Nothing here is functional yet.`}
      />
    </div>
  )
}
