import { supabase, requireAuth } from './supabase-client.js';
import { element } from './ui.js';
const errorEl = document.getElementById('admin-error');
async function load() {
  const { data, error } = await supabase.rpc('get_community_admin_dashboard');
  if (error) {
    errorEl.textContent = 'Admin access is required. If you are an admin, check that the latest migration has been applied.';
    errorEl.classList.remove('hidden'); document.getElementById('admin-stats').replaceChildren(); return false;
  }
  document.getElementById('admin-stats').replaceChildren(...[['Users', data.users], ['Conversations', data.conversations], ['Messages', data.messages], ['Upcoming events', data.events]].map(([label, count]) => {
    const card = element('article', 'admin-card');card.append(element('span', '', label), element('strong', '', Number(count || 0).toLocaleString())); return card;
  }));
  document.getElementById('admin-event-panel').classList.remove('hidden'); return true;
}
(async () => { if (await requireAuth()) await load(); })();
document.getElementById('admin-event-form').addEventListener('submit', async (event) => {
  event.preventDefault(); const button = document.getElementById('publish-event'), result = document.getElementById('event-result'); button.disabled = true;
  try {
    const { error } = await supabase.rpc('publish_special_event', {
      event_title: document.getElementById('event-title').value.trim(), event_body: document.getElementById('event-body').value.trim(),
      event_url: document.getElementById('event-url').value.trim(), event_start: new Date(document.getElementById('event-start').value).toISOString(), event_competition: document.getElementById('event-competition').value,
    });
    if (error) throw error;
    event.target.reset(); result.textContent = 'Event published. Its reminder will be delivered by the scheduled sync.'; await load();
  } catch (error) { result.textContent = error.message || 'The event could not be published.'; }
  finally { button.disabled = false; }
});
