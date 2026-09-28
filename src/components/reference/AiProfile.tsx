import { AlertTriangle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type { AiProfile as Profile } from '@/lib/referenceHires'

const VERDICT: Record<Profile['role_expectations'][number]['verdict'], { label: string; cls: string }> = {
  strong: { label: 'Strong', cls: 'border-emerald-200 bg-emerald-50 text-emerald-800' },
  adequate: { label: 'Adequate', cls: 'border-slate-200 bg-slate-50 text-slate-700' },
  weak: { label: 'Weak', cls: 'border-amber-200 bg-amber-50 text-amber-900' },
  not_evidenced: { label: 'Not evidenced', cls: 'border-dashed text-muted-foreground' },
}

function Quote({ text }: { text: string | null }) {
  if (!text) return <p className="mt-1 text-xs italic text-muted-foreground">Not evidenced</p>
  return <blockquote className="mt-1 border-l-2 pl-3 text-xs text-muted-foreground">“{text}”</blockquote>
}

export function AiProfile({ profile, model, at }: { profile: Profile; model: string | null; at: string | null }) {
  return (
    <div className="grid gap-5">
      <p className="text-sm">{profile.summary}</p>

      {profile.bias_flags.length > 0 && (
        <p className="flex items-center gap-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-800">
          <AlertTriangle className="size-3.5" aria-hidden /> Bias check flagged: {profile.bias_flags.join(', ')}. Review before relying on this.
        </p>
      )}

      <div>
        <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">What stands out</h4>
        <ul className="mt-2 grid gap-3">
          {profile.stands_out.map((s, i) => (
            <li key={i} className="text-sm">{s.point}<Quote text={s.quote} /></li>
          ))}
        </ul>
      </div>

      <div>
        <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Gaps</h4>
        <ul className="mt-2 grid gap-3">
          {profile.gaps.map((g, i) => (
            <li key={i} className="text-sm">{g.point}{g.quote && <Quote text={g.quote} />}</li>
          ))}
        </ul>
      </div>

      <div>
        <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Against typical role expectations</h4>
        <p className="mt-1 text-xs text-muted-foreground">
          Expectations come from the model's general knowledge of the role, not from Kargo. Each verdict is backed by a CV quote.
        </p>
        <ul className="mt-3 grid gap-3">
          {profile.role_expectations.map((e, i) => (
            <li key={i} className="text-sm">
              <div className="flex items-start justify-between gap-3">
                <span>{e.expectation}</span>
                <Badge variant="outline" className={VERDICT[e.verdict].cls}>{VERDICT[e.verdict].label}</Badge>
              </div>
              <Quote text={e.quote} />
            </li>
          ))}
        </ul>
      </div>

      <p className="text-xs text-muted-foreground">
        AI analysis by {model ?? '—'}
        {at && ` on ${new Date(at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}`}.
        Names, contact details, locations and colleges were removed before analysis. The model was not told this hire's rating.
      </p>
    </div>
  )
}
