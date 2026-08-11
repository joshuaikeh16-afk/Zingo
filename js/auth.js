// Auth page logic. This file expects a layout (built separately, e.g.
// in Google AI Studio) that includes the following element IDs:
//
//   #email-input          <input type="email">
//   #password-input       <input type="password">
//   #auth-submit-btn      <button> — triggers sign in or sign up
//   #auth-toggle-mode     <a> or <button> — switches between sign in / sign up
//   #auth-error-message   <p> or <div> — shown on failure, hidden otherwise
//   #auth-loading         optional — shown while a request is in flight
//
// The layout does not need to know anything about Supabase — this file
// owns all of that. It just needs those IDs to exist somewhere on the
// page for this script to attach to.

import { supabase } from './supabase-client.js';

let mode = 'signin'; // 'signin' | 'signup'

const emailInput = document.getElementById('email-input');
const passwordInput = document.getElementById('password-input');
const submitBtn = document.getElementById('auth-submit-btn');
const toggleBtn = document.getElementById('auth-toggle-mode');
const errorEl = document.getElementById('auth-error-message');
const loadingEl = document.getElementById('auth-loading');

function setError(message) {
  if (!errorEl) return;
  errorEl.textContent = message || '';
  errorEl.style.display = message ? 'block' : 'none';
}

function setLoading(isLoading) {
  if (loadingEl) loadingEl.style.display = isLoading ? 'block' : 'none';
  if (submitBtn) submitBtn.disabled = isLoading;
}

toggleBtn?.addEventListener('click', (e) => {
  e.preventDefault();
  mode = mode === 'signin' ? 'signup' : 'signin';
  setError(null);
  if (submitBtn) {
    submitBtn.textContent = mode === 'signin' ? 'Sign In' : 'Sign Up';
  }
  // Fires a custom event so the layout can react (e.g. swap a heading)
  // without this file needing to know the layout's exact structure.
  document.dispatchEvent(new CustomEvent('kaidra:auth-mode-changed', { detail: { mode } }));
});

submitBtn?.addEventListener('click', async (e) => {
  e.preventDefault();
  setError(null);

  const email = emailInput?.value?.trim();
  const password = passwordInput?.value;

  if (!email || !password) {
    setError('Enter both an email and a password.');
    return;
  }

  setLoading(true);
  try {
    const { error } = mode === 'signin'
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password });

    if (error) {
      setError(error.message);
      return;
    }

    // On success, go straight to onboarding -- it will redirect on to
    // the main app itself if a profile already exists (returning user).
    window.location.href = '/onboarding.html';
  } catch (err) {
    setError('Something went wrong. Try again.');
    console.error(err);
  } finally {
    setLoading(false);
  }
});

// If already signed in, skip the auth page entirely.
(async () => {
  const { data: { session } } = await supabase.auth.getSession();
  if (session) {
    window.location.href = '/onboarding.html';
  }
})();
