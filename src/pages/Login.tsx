import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { supabase, supabaseConfigError } from '@/lib/supabase'

export function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [linkSent, setLinkSent] = useState(false)

  async function sendMagicLink(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      // Never create accounts from the login screen.
      options: { shouldCreateUser: false, emailRedirectTo: window.location.origin },
    })
    setBusy(false)
    if (error) return toast.error(error.message)
    setLinkSent(true)
  }

  async function signInWithPassword(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    setBusy(false)
    if (error) toast.error(error.message)
  }

  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/40 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2">
          <img src="/favicon.svg" alt="" className="size-7" />
          <span className="text-sm font-semibold tracking-tight">Kargo Hiring</span>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Sign in</CardTitle>
            <CardDescription>Access is limited to the founder account.</CardDescription>
          </CardHeader>
          <CardContent>
            {supabaseConfigError ? (
              <p role="alert" className="text-sm text-destructive">{supabaseConfigError}</p>
            ) : (
              <Tabs defaultValue="magic">
                <TabsList className="mb-4 w-full">
                  <TabsTrigger value="magic">Email link</TabsTrigger>
                  <TabsTrigger value="password">Password</TabsTrigger>
                </TabsList>
                <TabsContent value="magic">
                  {linkSent ? (
                    <p className="text-sm text-muted-foreground" role="status">
                      If this email is registered, a sign-in link is on its way. You can close this tab
                      once you have opened it.
                    </p>
                  ) : (
                    <form onSubmit={sendMagicLink} className="grid gap-4">
                      <EmailField value={email} onChange={setEmail} id="magic-email" />
                      <Button type="submit" disabled={busy || !email}>
                        {busy ? 'Sending…' : 'Send sign-in link'}
                      </Button>
                    </form>
                  )}
                </TabsContent>
                <TabsContent value="password">
                  <form onSubmit={signInWithPassword} className="grid gap-4">
                    <EmailField value={email} onChange={setEmail} id="pw-email" />
                    <div className="grid gap-2">
                      <Label htmlFor="password">Password</Label>
                      <Input
                        id="password"
                        type="password"
                        autoComplete="current-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                      />
                    </div>
                    <Button type="submit" disabled={busy || !email || !password}>
                      {busy ? 'Signing in…' : 'Sign in'}
                    </Button>
                  </form>
                </TabsContent>
              </Tabs>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  )
}

function EmailField({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>Email</Label>
      <Input
        id={id}
        type="email"
        autoComplete="email"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required
      />
    </div>
  )
}
