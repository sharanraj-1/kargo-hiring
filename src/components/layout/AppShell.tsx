import { LogOut, Menu } from 'lucide-react'
import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { NAV_ITEMS } from './nav'

function Brand() {
  return (
    <div className="flex h-14 items-center gap-2 px-4">
      <img src="/favicon.svg" alt="" className="size-6" />
      <span className="text-sm font-semibold tracking-tight">Kargo Hiring</span>
    </div>
  )
}

function SidebarNav({ email, onNavigate }: { email: string; onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col">
      <Brand />
      <nav aria-label="Main" className="flex-1 space-y-0.5 px-2 py-2">
        {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors',
                'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                isActive && 'bg-sidebar-accent font-medium text-sidebar-accent-foreground',
              )
            }
          >
            <Icon className="size-4 shrink-0" aria-hidden />
            {label}
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-sidebar-border p-3">
        <p className="truncate px-1 pb-2 text-xs text-muted-foreground" title={email}>
          {email}
        </p>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2 text-muted-foreground"
          onClick={() => supabase.auth.signOut()}
        >
          <LogOut className="size-4" aria-hidden />
          Sign out
        </Button>
      </div>
    </div>
  )
}

export function AppShell({ email }: { email: string }) {
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <div className="min-h-svh bg-background">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:shadow"
      >
        Skip to content
      </a>

      <aside className="fixed inset-y-0 left-0 hidden w-60 border-r border-sidebar-border bg-sidebar lg:block">
        <SidebarNav email={email} />
      </aside>

      <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background px-4 lg:hidden">
        <Button variant="ghost" size="icon" aria-label="Open navigation" onClick={() => setMobileOpen(true)}>
          <Menu className="size-5" />
        </Button>
        <span className="text-sm font-semibold tracking-tight">Kargo Hiring</span>
      </header>
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-64 bg-sidebar p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SidebarNav email={email} onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>

      <main id="main" className="lg:pl-60">
        <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
