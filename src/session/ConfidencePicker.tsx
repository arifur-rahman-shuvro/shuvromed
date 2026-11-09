const LABELS = ['Guessing', 'Not sure', 'Fairly sure', 'Sure', 'Certain'] as const

/** An optional "how sure are you?" rating, 1 to 5. Pressing the chosen one again clears it. */
export default function ConfidencePicker({ value, onChange, disabled = false }: { value: number | undefined; onChange: (v: number | undefined) => void; disabled?: boolean }) {
  return (
    <fieldset className="flex flex-col gap-1" disabled={disabled}>
      <legend className="text-sm font-medium">How sure are you? (optional)</legend>
      <div className="flex flex-wrap gap-1">
        {LABELS.map((l, i) => (
          <button key={l} type="button" aria-pressed={value === i + 1} onClick={() => onChange(value === i + 1 ? undefined : i + 1)}
            className={`min-h-11 rounded-lg border px-3 text-sm ${value === i + 1 ? 'border-accent font-bold' : 'border-line'}`}>{l}</button>
        ))}
      </div>
    </fieldset>
  )
}
