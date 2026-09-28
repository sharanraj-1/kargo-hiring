import {
  FileText,
  LayoutDashboard,
  ListChecks,
  Mail,
  ScrollText,
  Settings,
  UserRoundCheck,
  Users,
  type LucideIcon,
} from 'lucide-react'

export type NavItem = { to: string; label: string; icon: LucideIcon }

export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Overview', icon: LayoutDashboard },
  { to: '/job-descriptions', label: 'Job descriptions', icon: FileText },
  { to: '/reference-hires', label: 'Reference hires', icon: UserRoundCheck },
  { to: '/candidates', label: 'Candidates', icon: Users },
  { to: '/below-threshold', label: 'Review below threshold', icon: ListChecks },
  { to: '/outbox', label: 'Outbox', icon: Mail },
  { to: '/decision-log', label: 'Decision log', icon: ScrollText },
  { to: '/settings', label: 'Settings', icon: Settings },
]
