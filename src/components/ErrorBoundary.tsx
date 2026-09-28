import { AlertTriangle } from 'lucide-react'
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'

type State = { error: Error | null }

/** Catches rendering errors so one broken screen doesn't blank the whole app. */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Screen crashed', error, info.componentStack)
  }

  componentDidUpdate(prev: { resetKey?: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null })
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div role="alert" className="mx-auto mt-16 max-w-md rounded-lg border px-6 py-8 text-center">
        <AlertTriangle className="mx-auto mb-3 size-6 text-amber-700" aria-hidden />
        <h1 className="text-base font-semibold">This screen hit an error</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your data is safe. Reload to try again. If it keeps happening, the details are in the browser console.
        </p>
        <p className="mt-3 break-words font-mono text-xs text-muted-foreground">{this.state.error.message}</p>
        <Button className="mt-6" variant="outline" onClick={() => window.location.reload()}>Reload</Button>
      </div>
    )
  }
}
