import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.117.2'

// SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are injected
// automatically into hosted Edge Functions; they are never stored in this repo.
function env(name: string): string {
  const value = Deno.env.get(name)
  if (!value) throw new Error(`Missing environment variable: ${name}`)
  return value
}

export type FounderContext = {
  userId: string
  email: string
  /** Service-role client. Bypasses RLS, so only use it after requireFounder() succeeds. */
  admin: SupabaseClient
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

/**
 * Verifies the caller's JWT and checks they are the founder (founder_allowlist).
 * Every Edge Function must call this before doing anything else.
 */
export async function requireFounder(req: Request): Promise<FounderContext> {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) throw new HttpError(401, 'Not signed in')

  const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false },
  })

  const asUser = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  })

  const { data: userData, error: userError } = await asUser.auth.getUser()
  if (userError || !userData.user?.email) throw new HttpError(401, 'Invalid session')

  const { data: isFounder, error: rpcError } = await asUser.rpc('is_founder')
  if (rpcError) throw new HttpError(500, 'Could not verify access')
  if (isFounder !== true) throw new HttpError(403, 'This account is not authorised')

  return { userId: userData.user.id, email: userData.user.email, admin }
}

/**
 * For AI processing jobs that may also be run by an operator from the server side
 * (e.g. a bulk import): accepts the founder's session OR the service role key.
 * Never use this for sending email: that must always be a founder click.
 */
export async function requireFounderOrService(req: Request): Promise<FounderContext | ServiceContext> {
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/, '')
  // These functions deploy with verify_jwt = true (see supabase/config.toml), so the gateway has
  // already verified the token's signature; here we only read its role claim.
  if (token && jwtRole(token) === 'service_role') {
    const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { persistSession: false },
    })
    return { userId: null, email: null, admin, isService: true }
  }
  return requireFounder(req)
}

export type ServiceContext = { userId: null; email: null; admin: SupabaseClient; isService: true }

function jwtRole(token: string): string | null {
  const payload = token.split('.')[1]
  if (!payload) return null
  try {
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(payload.length / 4) * 4, '='))
    return JSON.parse(json).role ?? null
  } catch {
    return null
  }
}
