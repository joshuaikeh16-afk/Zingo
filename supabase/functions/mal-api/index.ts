const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MAL_API = 'https://api.myanimelist.net/v2';
const MAL_OAUTH_TOKEN = 'https://myanimelist.net/v1/oauth2/token';

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function cleanLimit(value: unknown, fallback = 12) {
  return Math.min(Math.max(Number(value) || fallback, 1), 50);
}

async function malFetch(path: string, params: Record<string, string> = {}, token?: string) {
  const url = new URL(`${MAL_API}${path}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'X-MAL-CLIENT-ID': Deno.env.get('MAL_CLIENT_ID') || '',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.message || `MyAnimeList returned ${response.status}`);
  return payload;
}

async function userClient(request: Request) {
  const auth = request.headers.get('Authorization');
  if (!auth) throw new Error('Kaidra sign-in is required');
  const client = createClient(
    Deno.env.get('SUPABASE_URL') || '',
    Deno.env.get('SUPABASE_ANON_KEY') || '',
    { global: { headers: { Authorization: auth } } },
  );
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) throw new Error('Kaidra sign-in is required');
  return { client, user };
}

function adminClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL') || '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
  );
}

async function storedMalToken(request: Request) {
  const { user } = await userClient(request);
  const { data, error } = await adminClient().from('mal_connections').select('access_token').eq('user_id', user.id).maybeSingle();
  if (error || !data?.access_token) throw new Error('Connect your MyAnimeList account first');
  return { client, user, token: data.access_token };
}

function malFields(type = 'anime') {
  // Keep public catalog requests to fields MAL accepts without a user token.
  // my_list_status, recommendations, and related_anime are restricted or
  // endpoint-specific and can make otherwise valid catalog calls return 400.
  const common = ['id', 'title', 'main_picture', 'alternative_titles', 'synopsis', 'status', 'start_date', 'end_date', 'mean', 'rank', 'popularity', 'genres', 'themes', 'demographics', 'num_list_users'];
  const mediaFields = type === 'manga'
    ? ['media_type', 'num_chapters', 'num_volumes', 'authors', 'serialization']
    : ['media_type', 'num_episodes', 'studios', 'source', 'rating', 'average_episode_duration', 'broadcast', 'start_season'];
  return [...common, ...mediaFields].join(',');
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    if (!Deno.env.get('MAL_CLIENT_ID')) throw new Error('MAL_CLIENT_ID is not configured');
    const body = await request.json();
    const action = String(body.action || '');
    const limit = cleanLimit(body.limit);

    if (action === 'search') {
      const type = body.type === 'manga' ? 'manga' : 'anime';
      return json(await malFetch(`/${type}`, { q: String(body.query || ''), limit: String(limit), fields: malFields(type) }));
    }
    if (action === 'detail') {
      const type = body.type === 'manga' ? 'manga' : 'anime';
      return json(await malFetch(`/${type}/${encodeURIComponent(body.id)}`, { fields: malFields(type) }));
    }
    if (action === 'ranking') {
      const type = body.type === 'manga' ? 'manga' : 'anime';
      return json(await malFetch(`/${type}/ranking`, { ranking_type: String(body.rankingType || 'bypopularity'), limit: String(limit), fields: malFields(type) }));
    }
    if (action === 'genre') {
      const genre = String(body.genre || '');
      if (!/^\d+$/.test(genre)) throw new Error('A valid MAL genre is required');
      // MAL requires q on the /anime endpoint even when filtering by genre.
      const year = String(body.sort_year || body.year || 'all');
      const dateParams: Record<string, string> = {};
      const singleYear = /^\d{4}$/.test(year) ? Number(year) : null;
      const range = /^(\d{4})-(\d{4})$/.exec(year);
      if (singleYear) {
        dateParams.start_date = `${singleYear}-01-01`;
        dateParams.end_date = `${singleYear}-12-31`;
      } else if (range) {
        const newer = Math.max(Number(range[1]), Number(range[2]));
        const older = Math.min(Number(range[1]), Number(range[2]));
        dateParams.start_date = `${older}-01-01`;
        dateParams.end_date = `${newer}-12-31`;
      }
      const payload = await malFetch('/anime', { q: String(body.query || 'the'), genres: genre, sort: 'anime_start_date', offset: String(Math.max(Number(body.offset) || 0, 0)), limit: String(limit), ...dateParams, fields: malFields('anime') });
      // MAL can return a mixed page around date boundaries. Enforce the
      // selected year again before the response reaches the browser.
      const matchesYear = (item: { node?: { start_date?: string | null } }) => {
        const startDate = item.node?.start_date || '';
        const releaseYear = Number(startDate.slice(0, 4));
        if (!releaseYear || year === 'all') return true;
        if (/^\d{4}$/.test(year)) return releaseYear === Number(year);
        const match = /^(\d{4})-(\d{4})$/.exec(year);
        if (!match) return true;
        const high = Math.max(Number(match[1]), Number(match[2]));
        const low = Math.min(Number(match[1]), Number(match[2]));
        return releaseYear >= low && releaseYear <= high;
      };
      payload.data = (payload.data || []).filter(matchesYear).sort((a: { node?: { start_date?: string | null } }, b: { node?: { start_date?: string | null } }) => String(b.node?.start_date || '').localeCompare(String(a.node?.start_date || '')));
      return json(payload);
    }
    if (action === 'seasonal') {
      const year = String(body.year || new Date().getUTCFullYear());
      const season = String(body.season || 'winter');
      return json(await malFetch(`/anime/season/${year}/${season}`, { limit: String(limit), fields: malFields('anime') }));
    }
    if (action === 'upcoming') {
      return json(await malFetch('/anime/season/upcoming', { limit: String(limit), fields: malFields('anime') }));
    }
    if (action === 'recommendations') {
      return json(await malFetch(`/anime/${encodeURIComponent(body.id)}`, { fields: 'id,title,recommendations' }));
    }
    if (action === 'my-list') {
      const { token } = await storedMalToken(request);
      return json(await malFetch('/users/@me/animelist', {
        status: String(body.status || ''),
        limit: String(limit),
        offset: String(Number(body.offset) || 0),
        fields: 'list_status,id,title,main_picture,media_type,status,num_episodes,my_list_status',
      }, token));
    }
    if (action === 'connect') {
      const { user } = await userClient(request);
      const token = body.token || {};
      const malProfile = await malFetch('/users/@me', {}, String(token.access_token));
      const { error } = await adminClient().from('mal_connections').upsert({
        user_id: user.id,
        mal_user_id: malProfile.id,
        mal_username: malProfile.name,
        access_token: token.access_token,
        refresh_token: token.refresh_token || null,
        expires_at: new Date(Date.now() + Number(token.expires_in || 3600) * 1000).toISOString(),
        scope: token.scope || null,
        updated_at: new Date().toISOString(),
      });
      if (error) throw error;
      return json({ connected: true, user: malProfile });
    }
    if (action === 'connection-status') {
      const { user } = await userClient(request);
      const { data } = await adminClient().from('mal_connections').select('mal_username, mal_user_id, expires_at, updated_at').eq('user_id', user.id).maybeSingle();
      return json({ connected: !!data, connection: data || null });
    }
    if (action === 'update-list' || action === 'delete-list') {
      const { token } = await storedMalToken(request);
      const id = encodeURIComponent(body.id);
      const method = action === 'delete-list' ? 'DELETE' : 'PUT';
      const response = await fetch(`${MAL_API}/anime/${id}/mylist${action === 'update-list' ? '/status' : ''}`, {
        method,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-MAL-CLIENT-ID': Deno.env.get('MAL_CLIENT_ID') || '',
          Authorization: `Bearer ${token}`,
        },
        body: method === 'PUT' ? new URLSearchParams(Object.entries(body.fields || {}).map(([key, value]) => [key, String(value)])) : undefined,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.message || `MyAnimeList returned ${response.status}`);
      return json(payload);
    }
    if (action === 'authorize-url') {
      const redirectUri = String(body.redirectUri || '');
      const state = String(body.state || crypto.randomUUID());
      const url = new URL('https://myanimelist.net/v1/oauth2/authorize');
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('client_id', Deno.env.get('MAL_CLIENT_ID')!);
      url.searchParams.set('redirect_uri', redirectUri);
      url.searchParams.set('state', state);
      url.searchParams.set('code_challenge', String(body.codeChallenge || ''));
      url.searchParams.set('code_challenge_method', 'plain');
      return json({ url: url.toString(), state });
    }
    if (action === 'oauth-token') {
      const tokenResponse = await fetch(MAL_OAUTH_TOKEN, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: Deno.env.get('MAL_CLIENT_ID')!,
          grant_type: 'authorization_code',
          code: String(body.code || ''),
          code_verifier: String(body.codeVerifier || ''),
          redirect_uri: String(body.redirectUri || ''),
        }),
      });
      const tokenPayload = await tokenResponse.json();
      if (!tokenResponse.ok) throw new Error(tokenPayload?.message || 'MAL authorization failed');
      return json(tokenPayload);
    }
    throw new Error('Unknown MAL action');
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'MAL request failed' }, 400);
  }
});
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
