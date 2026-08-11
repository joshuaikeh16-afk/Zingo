// Single Supabase client instance, shared across every page.
// Every other JS file should import `supabase` from here — never
// initialize a second client elsewhere.

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://skmlktywdmsbjyybtmhm.supabase.co';
// Publishable/anon key — safe to ship client-side. RLS gates everything
// this key can touch. Never put the service_role key here or anywhere
// in this repo.
const SUPABASE_ANON_KEY = 'sb_publishable_IuCAP_wwm-rCBjCiunZUNQ_kOqmBeKC';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/**
 * Redirects to the sign-in page if there's no active session.
 * Call this at the top of any page that requires auth (everything
 * except index.html / auth.html).
 */
export async function requireAuth() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    window.location.href = '/auth.html';
    return null;
  }
  return session;
}

/**
 * Redirects to onboarding if the signed-in user has no profile row yet.
 * Call this after requireAuth() on any page inside the main app shell.
 */
export async function requireProfile(session) {
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', session.user.id)
    .maybeSingle();

  if (error) {
    console.error('Failed to load profile:', error);
    return null;
  }
  if (!profile) {
    window.location.href = '/onboarding.html';
    return null;
  }
  return profile;
}
