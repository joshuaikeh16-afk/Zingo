// Onboarding page logic (username, interests, optional avatar).
//
//   #username-input          <input type="text">
//   #username-availability   shown/hidden + text updated as the user types
//   #interest-chip           class (not id) on each selectable interest
//                             chip — must have data-interest="anime" etc.
//                             and toggle a class like .selected on click;
//                             this script reads .selected chips at submit
//   #avatar-input            <input type="file" accept="image/*"> (optional)
//   #onboarding-submit-btn   <button>
//   #onboarding-error        error message container
//
// Interest chips: layout should render one element per interest with
// data-interest="anime" / "news" / "idols_music" (etc.) and a shared
// class, e.g. class="interest-chip". This script queries
// `.interest-chip` and toggles `.selected` on click — the layout
// controls what "selected" looks like visually.

import { supabase, requireAuth, updateUserPreferences } from './supabase-client.js';

const usernameInput = document.getElementById('username-input');
const usernameAvailability = document.getElementById('username-availability');
const avatarInput = document.getElementById('avatar-input');
const submitBtn = document.getElementById('onboarding-submit-btn');
const errorEl = document.getElementById('onboarding-error');

let session = null;
let usernameCheckTimeout = null;

function setError(message) {
  if (!errorEl) return;
  errorEl.textContent = message || '';
  errorEl.style.display = message ? 'block' : 'none';
}

// --- Username availability check (debounced) ---
usernameInput?.addEventListener('input', () => {
  clearTimeout(usernameCheckTimeout);
  const value = usernameInput.value.trim();

  if (!usernameAvailability) return;
  if (value.length < 3) {
    usernameAvailability.textContent = '';
    return;
  }

  usernameAvailability.textContent = 'Checking...';
  usernameCheckTimeout = setTimeout(async () => {
    const { data, error } = await supabase
      .from('profiles')
      .select('id')
      .eq('username', value)
      .limit(1);

    if (error) {
      usernameAvailability.textContent = '';
      return;
    }
    usernameAvailability.textContent = data.length === 0 ? 'Available' : 'Already taken';
    usernameAvailability.classList.toggle('available', data.length === 0);
    usernameAvailability.classList.toggle('taken', data.length > 0);
  }, 400);
});

// --- Interest chip selection ---
document.querySelectorAll('.interest-chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    chip.classList.toggle('selected');
  });
});

function getSelectedInterests() {
  return Array.from(document.querySelectorAll('.interest-chip.selected'))
    .map((el) => el.dataset.interest)
    .filter(Boolean);
}

// --- Avatar preview ---
avatarInput?.addEventListener('change', () => {
  const file = avatarInput.files?.[0];
  const preview = document.getElementById('avatar-preview');
  const placeholder = document.getElementById('avatar-placeholder');
  if (!file || !preview) return;
  preview.src = URL.createObjectURL(file);
  preview.classList.remove('hidden');
  placeholder?.classList.add('hidden');
});

// --- Submit ---
submitBtn?.addEventListener('click', async (e) => {
  e.preventDefault();
  setError(null);

  const username = usernameInput?.value?.trim();
  const interests = getSelectedInterests();

  if (!username || username.length < 3) {
    setError('Pick a username (at least 3 characters).');
    return;
  }
  submitBtn.disabled = true;
  try {
    // Re-read the user from Supabase before writing the profile. This is
    // important after an OAuth callback: a cached session can exist in the
    // browser before the Auth user has been fully confirmed by the API.
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      setError('Your sign-in session is not ready. Please sign in again.');
      submitBtn.disabled = false;
      return;
    }
    session = { ...session, user };

    let avatarUrl = null;
    const file = avatarInput?.files?.[0];
    if (file) {
      const path = `${session.user.id}/avatar.${file.name.split('.').pop()}`;
      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(path, file, { upsert: true });
      if (uploadError) {
        setError('Avatar upload failed: ' + uploadError.message);
        submitBtn.disabled = false;
        return;
      }
      const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path);
      avatarUrl = urlData.publicUrl + '?v=' + Date.now();
    }

    // Upsert, not insert -- this page now shows on every sign-in (not
    // just the first), so returning users re-submitting their existing
    // profile row must update it rather than fail on a duplicate id.
    const { error: upsertError } = await supabase.from('profiles').upsert({
      id: session.user.id,
      username,
      interests,
      ...(avatarUrl ? { avatar_url: avatarUrl } : {}),
    });

    if (upsertError) {
      setError(
        upsertError.code === '23505'
          ? 'That username is already taken.'
          : upsertError.message
      );
      submitBtn.disabled = false;
      return;
    }

    // New accounts start in the safer under-18 content mode. Users can
    // explicitly change this later from Profile > Settings.
    await updateUserPreferences(session.user.id, { nsfw_filter: false });

    window.location.replace('/app.html');
  } catch (err) {
    setError('Something went wrong. Try again.');
    console.error(err);
    submitBtn.disabled = false;
  }
});

// --- Init: require auth, and skip straight to the app if a profile
// already exists (this page is only meant to be reached from sign-up,
// or as a fallback if a session somehow has no profile yet). Also
// re-checked on bfcache restore (pageshow persisted) -- see auth.js
// for why that matters. ---
async function checkAuthAndExistingProfile() {
  session = await requireAuth();
  if (!session) return;

  const { data: existingProfile } = await supabase
    .from('profiles')
    .select('id')
    .eq('id', session.user.id)
    .maybeSingle();

  if (existingProfile) {
    window.location.replace('/app.html');
  }
}

checkAuthAndExistingProfile();
window.addEventListener('pageshow', (e) => {
  if (e.persisted) checkAuthAndExistingProfile();
});
