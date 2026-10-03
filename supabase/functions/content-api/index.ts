import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { cors, json, cached, upstream, allowedUrl, news, fixtures } from '../_shared/content.ts';
import { catalog } from '../_shared/catalog.ts';

const tmdbToken = () => Deno.env.get('TMDB_API_READ_TOKEN')?.trim();
const tmdbConfigured = () => !!(tmdbToken() || Deno.env.get('TMDB_API_KEY')?.trim());
async function tmdb(path: string, parameters: Record<string, string> = {}) {
  const url = new URL(`https://api.themoviedb.org/3${path}`);
  Object.entries(parameters).forEach(([key, value]) => url.searchParams.set(key, value));
  const token = tmdbToken();
  const apiKey = Deno.env.get('TMDB_API_KEY')?.trim() || (/^[a-f0-9]{32}$/i.test(token || '') ? token : null);
  if (apiKey && (!token || apiKey === token)) url.searchParams.set('api_key', apiKey);
  const headers: Record<string,string> = url.searchParams.has('api_key') ? {} : { Authorization: `Bearer ${token}` };
  return cached(url.href, 300, async () => (await upstream(url.href, headers)).json());
}
Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: request.headers.get('Authorization') || '' } } });
    const { data: { user } } = await client.auth.getUser();
    if (!user) return json({ error: 'Sign in required' }, 401);
    const body = await request.json();
    const region = ['NG', 'GH', 'ZA', 'KE', 'GB', 'US', 'CA', 'IN'].includes(body.region) ? body.region : 'NG';
    if (body.action === 'news') return json({ items: await news(body.kind === 'football' ? 'football' : 'entertainment') });
    if (body.action === 'fixtures') return json(await fixtures());
    if (body.action === 'catalog') {
      if (!tmdbConfigured()) return json({ configured: false, items: [], hasMore: false, code: 'TMDB_NOT_CONFIGURED' });
      const { data: profile, error } = await client.from('profiles').select('interests,recommendation_preferences').eq('id', user.id).maybeSingle();
      if (error) return json({ error: 'Recommendations could not load. Please try again.', code: 'PROFILE_SCHEMA_UNAVAILABLE' },503);
      return json(await catalog(body, profile, tmdb));
    }
    if (body.action === 'detail') {
      if (!tmdbConfigured()) return json({ configured: false });
      if (!/^\d+$/.test(String(body.id)) || !['movie','tv'].includes(body.type)) return json({ error: 'Invalid title' },400);
      const item = await tmdb(`/${body.type}/${body.id}`, { append_to_response: 'videos,credits', language: 'en-US' });
      if (item.adult) return json({ error: 'This title is unavailable' },404);
      const trailer = (item.videos?.results || []).find((video: any) => video.official && video.site === 'YouTube' && video.type === 'Trailer' && /^[a-zA-Z0-9_-]{11}$/.test(video.key));
      return json({ configured: true, id: item.id, kind: body.type, type: body.type, title: item.title || item.name, subtitle: item.overview,
        image: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : null,
        backdrop: item.backdrop_path ? `https://image.tmdb.org/t/p/w1280${item.backdrop_path}` : null,
        genres: (item.genres || []).map((genre: any) => genre.name), rating: item.vote_average,
        date: item.release_date || item.first_air_date, runtime: item.runtime || null,
        cast: (item.credits?.cast || []).slice(0,5).map((person: any) => person.name),
        trailerKey: trailer?.key || null, url: `https://www.themoviedb.org/${body.type}/${item.id}` });
    }
    if (body.action === 'match') {
      const data = await fixtures();
      const match = data.matches.find((match: any) => String(match.id) === String(body.id));
      return json({ configured: data.configured, match: match || null, updatedAt: data.updatedAt });
    }
    if (body.action === 'providers') {
      if (!tmdbConfigured()) return json({ configured: false, providers: [] });
      if (!/^\d+$/.test(String(body.id)) || !['movie', 'tv'].includes(body.type)) return json({ error: 'Invalid title' }, 400);
      const data = await tmdb(`/${body.type}/${body.id}/watch/providers`);
      const availability = data.results?.[region];
      const providers = ['flatrate', 'free', 'ads', 'rent', 'buy'].flatMap((kind) => (availability?.[kind] || []).map((provider: any) => ({ name: provider.provider_name, kind })));
      return json({ configured: true, region, providers, link: allowedUrl(availability?.link, ['themoviedb.org']), checkedAt: new Date().toISOString() });
    }
    return json({ error: 'Unknown action' }, 400);
  } catch (error) {
    console.error('Content request failed:', error instanceof Error ? error.message : 'Unknown provider error');
    if (error instanceof RangeError) return json({ error: 'Invalid catalog page' },400);
    return json({ error: 'This feed is temporarily unavailable. Please try again.' }, 502);
  }
});
