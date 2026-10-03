import { XMLParser } from 'npm:fast-xml-parser@5.11.2';

export const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}
const cache = new Map<string, { until: number; value: unknown }>();
export async function cached<T>(key: string, seconds: number, loader: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.value as T;
  const value = await loader();
  if (cache.size >= 100) cache.delete(cache.keys().next().value!);
  cache.set(key, { until: Date.now() + seconds * 1000, value });
  return value;
}
export async function upstream(url: string, headers: Record<string, string> = {}) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error(`Content provider returned ${response.status}`);
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
export async function fixtures() {
  const token = Deno.env.get('FOOTBALL_DATA_TOKEN');
  if (!token) return { configured: false, matches: [], updatedAt: null };
  return cached('fixtures', 60, async () => {
    const from = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const to = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    const data = await (await upstream(`https://api.football-data.org/v4/matches?dateFrom=${from}&dateTo=${to}`, { 'X-Auth-Token': token })).json();
    return {
      configured: true, updatedAt: new Date().toISOString(),
      matches: (data.matches || []).map((match: any) => ({
        id: match.id, home: match.homeTeam?.name || 'TBC', away: match.awayTeam?.name || 'TBC',
        homeCrest: allowedUrl(match.homeTeam?.crest, ['football-data.org']), awayCrest: allowedUrl(match.awayTeam?.crest, ['football-data.org']),
        competition: match.competition?.code || '', competitionName: match.competition?.name || '',
        utcDate: match.utcDate, status: match.status, score: match.score?.fullTime || {}, updatedAt: match.lastUpdated,
      })),
    };
  });
}
