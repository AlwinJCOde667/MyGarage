import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

if (!supabaseUrl || !supabasePublishableKey) {
  throw new Error('Supabase environment variables are missing.')
}

export const supabase = createClient(
  supabaseUrl,
  supabasePublishableKey
)

// Capture Google provider token status as soon as the Supabase client loads.
let googleProviderTokenStatus = {
  checked: false,
  hasAccessToken: false,
  hasRefreshToken: false,
}

export function getGoogleProviderTokenStatus() {
  return { ...googleProviderTokenStatus }
}

supabase.auth.onAuthStateChange((_event, session) => {
  if (!session) return

  googleProviderTokenStatus = {
    checked: true,
    hasAccessToken: Boolean(session.provider_token),
    hasRefreshToken: Boolean(session.provider_refresh_token),
  }
})