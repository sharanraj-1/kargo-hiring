import type { Session } from '@supabase/supabase-js'
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { supabase } from './supabase'

type AuthState =
  | { status: 'loading' }
  | { status: 'signed_out' }
  | { status: 'unauthorised'; session: Session }
  | { status: 'founder'; session: Session }

const AuthContext = createContext<AuthState>({ status: 'loading' })

async function resolve(session: Session | null): Promise<AuthState> {
  if (!session) return { status: 'signed_out' }
  const { data, error } = await supabase.rpc('is_founder')
  if (error || data !== true) return { status: 'unauthorised', session }
  return { status: 'founder', session }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' })

  useEffect(() => {
    let active = true
    supabase.auth.getSession().then(async ({ data }) => {
      const next = await resolve(data.session)
      if (active) setState(next)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'TOKEN_REFRESHED') return
      // Defer the RPC so it doesn't run inside the auth callback.
      setTimeout(async () => {
        const next = await resolve(session)
        if (active) setState(next)
      }, 0)
    })
    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [])

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  return useContext(AuthContext)
}
