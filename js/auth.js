// Auth page logic. Sign In (auth.html) and Sign Up (signup.html) are now
// two separate pages, not a single page with a toggle. Each sets
// data-auth-mode="signin" or "signup" on <body> -- this file reads that
// once and never changes it. Expects on the page:
//
//   #email-input          <input type="email">
//   #password-input       <input type="password">
//   #auth-submit-btn      <button> — triggers sign in or sign up
//   #auth-error-message   <p> or <div> — shown on failure, hidden otherwise
//   #auth-loading         optional — shown while a request is in flight

import { supabase } from './supabase-client.js';

const mode = document.body.dataset.authMode === 'signup' ? 'signup' : 'signin';

const emailInput = document.getElementById('email-input');
const passwordInput = document.getElementById('password-input');
const submitBtn = document.getElementById('auth-submit-btn');
const errorEl = document.getElementById('auth-error-message');
const loadingEl = document.getElementById('auth-loading');

function setError(message) {
  if (!errorEl) return;
  errorEl.textContent = message || '';
  errorEl.classList.toggle('hidden', !message);
}

function setLoading(isLoading) {
  if (loadingEl) loadingEl.classList.toggle('hidden', !isLoading);
  if (submitBtn) submitBtn.disabled = isLoading;
}

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

    // On success, go straight to onboarding -- it shows the
    // personalization step on every sign-in, prefilled for returning
    // users (see js/onboarding.js).
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
