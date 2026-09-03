// Reset Password page logic.
// Supabase's password-reset email links here with a recovery token in
// the URL (hash or ?code=). supabase-js auto-detects it on load and
// fires a PASSWORD_RECOVERY auth event once that session is
// established -- only then do we reveal the "set new password" form.
// If the link is invalid/expired, no such event fires and we show an
// error instead of a form that would just fail on submit.

import { supabase } from './supabase-client.js';

const subtitleEl = document.getElementById('reset-subtitle');
const errorEl = document.getElementById('reset-error-message');
const loadingEl = document.getElementById('reset-loading');
const form = document.getElementById('reset-form');
const newPasswordInput = document.getElementById('new-password-input');
const confirmPasswordInput = document.getElementById('confirm-password-input');
const submitBtn = document.getElementById('reset-submit-btn');

let recoveryReady = false;

function setError(message) {
  if (!errorEl) return;
  errorEl.textContent = message || '';
  errorEl.classList.toggle('hidden', !message);
}

function setLoading(isLoading) {
  if (loadingEl) loadingEl.classList.toggle('hidden', !isLoading);
  if (submitBtn) submitBtn.disabled = isLoading;
}

supabase.auth.onAuthStateChange((event) => {
  if (event === 'PASSWORD_RECOVERY') {
    recoveryReady = true;
    if (subtitleEl) subtitleEl.textContent = 'Choose a new password for your account.';
    form?.classList.remove('hidden');
  }
});

// If the recovery event hasn't fired shortly after load, the link was
// invalid, expired, or already used -- tell the user plainly instead
// of leaving them stuck on "Verifying...".
setTimeout(() => {
  if (!recoveryReady) {
    if (subtitleEl) subtitleEl.textContent = '';
    setError('This reset link is invalid or has expired. Request a new one from the Sign In page.');
  }
}, 3000);

form?.addEventListener('submit', async (e) => {
  e.preventDefault();
  setError(null);

  const password = newPasswordInput?.value;
  const confirm = confirmPasswordInput?.value;

  if (!password || password.length < 6) {
    setError('Password must be at least 6 characters.');
    return;
  }
  if (password !== confirm) {
    setError('Passwords do not match.');
    return;
  }

  setLoading(true);
  try {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setError(error.message);
      return;
    }
    if (subtitleEl) subtitleEl.textContent = 'Password updated. Redirecting to sign in…';
    form.classList.add('hidden');
    await supabase.auth.signOut();
    setTimeout(() => { window.location.href = '/auth.html'; }, 1500);
  } catch (err) {
    setError('Something went wrong. Try again.');
    console.error(err);
  } finally {
    setLoading(false);
  }
});
