import { Badge } from '@/components/ui/badge'
import { RATING_LABEL, TENURE_LABEL, type Rating, type ReferenceType, type Tenure } from '@/lib/referenceHires'
import { cn } from '@/lib/utils'

const GREEN = 'border-emerald-200 bg-emerald-50 text-emerald-800'
const AMBER = 'border-amber-200 bg-amber-50 text-amber-900'
const GREY = 'border-slate-200 bg-slate-50 text-slate-700'
const RED = 'border-red-200 bg-red-50 text-red-800'
const MISSING = 'border-dashed text-muted-foreground'

export function RatingBadge({ rating }: { rating: Rating | null }) {
  if (!rating) return <Badge variant="outline" className={MISSING}>Not set</Badge>
  const cls = rating === 'exceeds' ? GREEN : rating === 'meets' ? GREY : RED
  return <Badge variant="outline" className={cls}>{RATING_LABEL[rating]}</Badge>
}

export function TenureBadge({ tenure }: { tenure: Tenure | null }) {
  if (!tenure) return <Badge variant="outline" className={MISSING}>Not set</Badge>
  return <Badge variant="outline" className={tenure === 'yes' ? GREY : AMBER}>{TENURE_LABEL[tenure]}</Badge>
}

const TYPE_LABEL: Record<ReferenceType, string> = {
  positive: 'Positive',
  neutral: 'Neutral',
  negative: 'Negative',
  unclassified: 'Needs details',
}

export function ReferenceTypeBadge({ type, className }: { type: ReferenceType; className?: string }) {
  const cls = { positive: GREEN, neutral: GREY, negative: RED, unclassified: MISSING }[type]
  return <Badge variant="outline" className={cn(cls, className)}>{TYPE_LABEL[type]}</Badge>
}
