import { XMLParser } from 'npm:fast-xml-parser@5.11.2';

export const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}
const cache = new Map<string, { until: number; value: unknown }>();
const requests = new Map<string, Promise<any>>();
export async function cached<T>(key: string, seconds: number, loader: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.value as T;
  if(requests.has(key))return requests.get(key)!;
  const request=loader(); requests.set(key,request);
  let value:T; try{value=await request;}finally{requests.delete(key);}
  if (cache.size >= 100) cache.delete(cache.keys().next().value!);
  cache.set(key, { until: Date.now() + seconds * 1000, value });
  return value;
}
export async function upstream(url: string, headers: Record<string, string> = {}) {
  let response: Response;
  try { response=await fetch(url,{headers,signal:AbortSignal.timeout(12000)}); }
  catch(error){throw Object.assign(new Error('Content provider could not be reached'),{code:error instanceof Error&&['TimeoutError','AbortError'].includes(error.name)?'UPSTREAM_TIMEOUT':'UPSTREAM_NETWORK'});}
  if(!response.ok)throw Object.assign(new Error(`Content provider returned ${response.status}`),{code:`UPSTREAM_HTTP_${response.status}`});
  return response;
}
export function allowedUrl(value: unknown, domains: string[]) {
  try {
    const url = new URL(String(value));
    return url.protocol === 'https:' && domains.some((domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`)) ? url.href : null;
  } catch { return null; }
}
export async function news(kind: 'football' | 'entertainment') {
  return cached(`news:${kind}`, 300, async () => {
    const url = kind === 'football' ? 'https://feeds.bbci.co.uk/sport/football/rss.xml' : 'https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml';
    const xml = await (await upstream(url)).text();
    const parsed = new XMLParser({ ignoreAttributes: false, processEntities: true }).parse(xml);
    const items = parsed?.rss?.channel?.item || [];
    return (Array.isArray(items) ? items : [items]).slice(0, 20).map((item: any) => ({
      id: String(item.guid?.['#text'] || item.guid || item.link),
      title: String(item.title || ''), url: allowedUrl(item.link, ['bbc.co.uk', 'bbc.com']),
      publishedAt: Number.isFinite(Date.parse(item.pubDate)) ? new Date(item.pubDate).toISOString() : null,
      source: kind === 'football' ? 'BBC Sport' : 'BBC News',
      summary: String(item.description || '').replace(/<[^>]*>/g, '').slice(0,500),
      image: allowedUrl(item['media:thumbnail']?.['@_url'], ['bbci.co.uk','bbc.co.uk']),
    })).filter((item: any) => item.title && item.url);
  });
}
export function normalizeMatch(match: any) {
 return {id:match.id,homeId:match.homeTeam?.id,awayId:match.awayTeam?.id,home:match.homeTeam?.name||'TBC',away:match.awayTeam?.name||'TBC',homeCrest:allowedUrl(match.homeTeam?.crest,['football-data.org']),awayCrest:allowedUrl(match.awayTeam?.crest,['football-data.org']),competition:match.competition?.code||'',competitionName:match.competition?.name||'',competitionCrest:allowedUrl(match.competition?.emblem,['football-data.org']),utcDate:match.utcDate,status:match.status,score:match.score?.fullTime||{},updatedAt:match.lastUpdated};
}
export async function football(path: string) {
 const token=Deno.env.get('FOOTBALL_DATA_TOKEN');if(!token)return null;
 return cached(`football:${path}`,path.startsWith('/matches/')?30:3600,async()=> (await upstream(`https://api.football-data.org/v4${path}`,{'X-Auth-Token':token})).json());
}
export async function fixtures() {
  const token = Deno.env.get('FOOTBALL_DATA_TOKEN');
  if (!token) return { configured: false, matches: [], updatedAt: null };
  return cached('fixtures', 60, async () => {
    const from = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const to = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    const data = await (await upstream(`https://api.football-data.org/v4/matches?dateFrom=${from}&dateTo=${to}`, { 'X-Auth-Token': token })).json();
    return {
      configured: true, updatedAt: new Date().toISOString(),
      matches: (data.matches || []).map(normalizeMatch),
    };
  });
}
