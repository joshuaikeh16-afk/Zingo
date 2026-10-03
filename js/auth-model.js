export const usernamePattern = /^[a-z0-9_]{3,24}$/;
const reserved = new Set(['admin','administrator','support','kaidra','system','moderator','official','help','null','undefined']);
export const normalizeUsername = value => String(value || '').trim().replace(/^@/, '').toLowerCase();
export function usernameError(value) { const name = normalizeUsername(value); return !usernamePattern.test(name) ? 'Use 3–24 letters, numbers, or underscores.' : reserved.has(name) ? 'That name is reserved. Choose another.' : ''; }
export function passwordFeedback(value) { return { valid: value.length >= 8, message: value.length >= 8 ? 'Ready. A longer, unique password is even better.' : 'Use at least 8 characters. A few words work well.' }; }
export function authError(error, action = 'signin') {
  if (error?.code === '23505') return 'That username is taken. Choose another.';
  const code = error?.code || '', message = error?.message || '';
  if (/rate_limit|over_email_send|over_request/.test(code) || error?.status === 429) return 'Too many attempts. Wait a minute, then try again.';
  if (/invalid_credentials/.test(code)) return 'That email and password don’t match. Try again or reset your password.';
  if (/user_already_exists|email_exists/.test(code)) return 'An account already uses this email. Log in or reset your password.';
  if (/email_not_confirmed/.test(code)) return 'Verify your email before logging in.';
  if (/weak_password/.test(code)) return 'Choose a stronger password with at least 8 characters.';
  if (/email_address_invalid|validation_failed/.test(code)) return 'Check your email address and try again.';
  if (/otp_expired|flow_state_expired/.test(code)) return 'That verification link has expired. Request a new one.';
  if (/fetch|network|timeout|abort/i.test(message) || error?.name === 'AbortError') return action === 'signup' ? 'We couldn’t confirm the result. Check your inbox or try logging in before creating an account again.' : 'Connection interrupted. Check your internet and try again.';
  return 'Could not complete that step. Please try again.';
}
export const authDestination = profile => profile && profile.onboarding_completed !== false ? '/app.html#home' : '/onboarding.html';
export function cleanDraft(value = {}) {
  const strings = list => Array.isArray(list) ? [...new Set(list.filter(item => typeof item === 'string'))].slice(0,20) : [];
  return { username: normalizeUsername(value.username), display_name: String(value.display_name || '').slice(0,60), avatar_url: String(value.avatar_url || '').slice(0,2048), categories: strings(value.categories).filter(item => ['movie','tv','anime','football'].includes(item)), genres: strings(value.genres), country: /^[A-Z]{2}$/.test(value.country) ? value.country : 'NG', language: /^(any|[a-z]{2})$/.test(value.language) ? value.language : 'any', providers: Array.isArray(value.providers) ? value.providers.filter(Number.isInteger).slice(0,10) : [], favorites: Array.isArray(value.favorites) ? value.favorites.filter(item => item && ['movie','tv'].includes(item.kind || item.type) && /^\d+$/.test(String(item.id))).slice(0,3) : [] };
}
