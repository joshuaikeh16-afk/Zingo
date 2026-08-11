// Onboarding page logic (username, birthdate/DOB gate, interests,
// optional avatar). Expects a layout with these element IDs:
//
//   #username-input          <input type="text">
//   #username-availability   shown/hidden + text updated as the user types
//   #birthdate-input         <input type="date">
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

import { supabase, requireAuth } from './supabase-client.js';

const usernameInput = document.getElementById('username-input');
const usernameAvailability = document.getElementById('username-availability');
const birthdateInput = document.getElementById('birthdate-input');
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

// --- 13+ DOB gate check ---
function isOldEnough(birthdateStr) {
  const birthdate = new Date(birthdateStr);
  const today = new Date();
  let age = today.getFullYear() - birthdate.getFullYear();
  const monthDiff = today.getMonth() - birthdate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthdate.getDate())) {
    age--;
  }
  return age >= 13;
}

// --- Submit ---
submitBtn?.addEventListener('click', async (e) => {
  e.preventDefault();
  setError(null);

  const username = usernameInput?.value?.trim();
  const birthdate = birthdateInput?.value;
  const interests = getSelectedInterests();

  if (!username || username.length < 3) {
    setError('Pick a username (at least 3 characters).');
    return;
  }
  if (!birthdate) {
    setError('Enter your birthdate.');
    return;
  }
  if (!isOldEnough(birthdate)) {
    setError('You must be 13 or older to use Kaidra.');
    return;
  }

  submitBtn.disabled = true;
  try {
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
      avatarUrl = urlData.publicUrl;
    }

    const { error: insertError } = await supabase.from('profiles').insert({
      id: session.user.id,
      username,
      birthdate,
      interests,
      ...(avatarUrl ? { avatar_url: avatarUrl } : {}),
    });

    if (insertError) {
      setError(
        insertError.code === '23505'
          ? 'That username is already taken.'
          : insertError.message
      );
      submitBtn.disabled = false;
      return;
    }

    window.location.href = '/app.html';
  } catch (err) {
    setError('Something went wrong. Try again.');
    console.error(err);
    submitBtn.disabled = false;
  }
});

// --- Init: require auth, and skip straight to the app if a profile
// already exists (returning user landing here by mistake, e.g. via
// back button) ---
(async () => {
  session = await requireAuth();
  if (!session) return;

  const { data: existingProfile } = await supabase
    .from('profiles')
    .select('id')
    .eq('id', session.user.id)
    .maybeSingle();

  if (existingProfile) {
    window.location.href = '/app.html';
  }
})();
