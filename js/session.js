import { requireAuth, requireProfile } from './supabase-client.js';
import { notify } from './ui.js';

// Share one authentication/profile check across the app's feature modules.
export const account = (async () => {
  try {
    const session = await requireAuth();
    if (!session) return null;
    const profile = await requireProfile(session);
    return profile ? { userId: session.user.id, profile } : null;
  } catch (error) {
    notify('Could not load your account. Refresh to try again.');
    console.error(error);
    return null;
  }
})();
