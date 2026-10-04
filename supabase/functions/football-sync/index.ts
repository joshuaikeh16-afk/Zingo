import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { fixtures, news, json } from '../_shared/content.ts';

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const secret = Deno.env.get('FOOTBALL_SYNC_SECRET');
  if (!secret || request.headers.get('x-sync-secret') !== secret) return json({ error: 'Unauthorized' }, 401);
  try {
    const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const results = await Promise.allSettled([fixtures(), news('football')]);
    const events: Record<string, unknown>[] = [];
    const data = results[0].status === 'fulfilled' ? results[0].value : { matches: [] };
    for (const match of data.matches) {
      const url = match.competition === 'PL' ? 'https://www.premierleague.com/en/video/highlights' : match.competition === 'CL' ? 'https://www.uefa.tv/' : 'https://www.plus.fifa.com/en';
      if (['SCHEDULED','TIMED'].includes(match.status)) {
        events.push({ event_key: `match:${match.id}:kickoff`, kind: 'kickoff', title: `${match.home} vs ${match.away}`, body: `Kickoff in 10 minutes · ${match.competitionName}`, url, competition: match.competition, starts_at: match.utcDate, notify_at: new Date(Date.parse(match.utcDate) - 600000).toISOString() });
      } else if (match.status === 'FINISHED' && match.score.home != null && match.score.away != null) {
        events.push({ event_key: `match:${match.id}:result`, kind: 'result', title: `${match.home} ${match.score.home}–${match.score.away} ${match.away}`, body: `Full time · ${match.competitionName}. Visit the official highlights hub.`, url, competition: match.competition, starts_at: match.utcDate, notify_at: match.updatedAt || new Date().toISOString() });
      }
      if (['POSTPONED','CANCELLED','SUSPENDED'].includes(match.status)) {
        // Never deliver an obsolete kickoff reminder after a schedule change.
        const { error } = await client.from('sports_events').delete().eq('event_key', `match:${match.id}:kickoff`).is('delivered_at', null);
        if (error) throw error;
      }
    }
    const headlines = results[1].status === 'fulfilled' ? results[1].value : [];
    for (const article of headlines) {
      if (article.publishedAt) events.push({ event_key: `news:${article.url}`, kind: 'news', title: article.title, body: 'BBC Sport · Football', url: article.url, competition: 'ALL', starts_at: article.publishedAt, notify_at: article.publishedAt });
    }
    if (events.length) {
      // Update fixture metadata without resetting notification delivery.
      const { error } = await client.rpc('upsert_sports_events', { items: events });
      if (error) throw error;
    }
    const { data: delivered, error } = await client.rpc('deliver_due_sports_notifications');
    if (error) throw error;
    const warnings = results.flatMap((result, index) => result.status === 'rejected' ? [index === 0 ? 'Fixtures unavailable' : 'News unavailable'] : []);
    return json({ synced: events.length, delivered, warnings });
  } catch (error) { console.error(error); return json({ error: 'Football sync failed' }, 500); }
});
