import { supabase, requireAuth } from './supabase-client.js';

const statsEl = document.getElementById('admin-stats');
const commentsEl = document.getElementById('admin-comments');
const errorEl = document.getElementById('admin-error');

function showError(message) {
  if (!errorEl) return;
  errorEl.textContent = message;
  errorEl.classList.remove('hidden');
  statsEl?.classList.add('hidden');
  commentsEl.textContent = '';
}

function renderDashboard(data) {
  const cards = [['Users', data.users], ['Video posts', data.posts], ['Comments', data.comments], ['Likes', data.likes]];
  statsEl.innerHTML = cards.map(([label, value]) => `<article class="admin-card"><span>${label}</span><strong>${Number(value || 0).toLocaleString()}</strong></article>`).join('');
  const comments = data.recent_comments || [];
  commentsEl.innerHTML = comments.length ? comments.map((item) => `<article class="admin-event"><span><strong>${item.username || 'Kaidra member'}</strong> — ${item.content || ''}</span><small>${new Date(item.created_at).toLocaleString()}</small></article>`).join('') : '<p>No recent comments.</p>';
}

(async () => {
  const session = await requireAuth();
  if (!session) return;
  const { data, error } = await supabase.rpc('get_admin_dashboard');
  if (error) {
    console.error('Admin dashboard failed:', error);
    showError(error.message.includes('admin access') ? 'You are not authorized to view the Kaidra admin dashboard.' : 'The admin dashboard is not available yet. Apply the admin migration first.');
    return;
  }
  renderDashboard(data);
})();
