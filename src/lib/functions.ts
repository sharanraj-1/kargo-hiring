import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from './supabase'

/** Invokes an Edge Function with the founder's session and surfaces its error message. */
export async function invokeFunction<T>(name: string, body: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body })
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const payload = await error.context.json().catch(() => null)
      throw new Error(payload?.error ?? error.message)
    }
    throw error
  }
  return data as T
}
