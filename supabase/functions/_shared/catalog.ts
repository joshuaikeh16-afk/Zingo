type MovieRequest = (path: string, parameters: Record<string, string>) => Promise<any>;
const supported = ['movie', 'tv', 'anime'];
const genres: Record<string, number[]> = { action: [28,10759], adventure: [12,10759], comedy: [35,35], drama: [18,18], fantasy: [14,10765], romance: [10749,18], thriller: [53,9648], mystery: [9648,9648], scifi: [878,10765], documentary: [99,99], animation: [16,16] };
export async function catalog(body: any, profile: any, tmdb: MovieRequest) {
  const page = Number(body.page ?? 1);
  if (!Number.isInteger(page) || page < 1 || page > 500) throw new RangeError('Invalid catalog page');
  const category = supported.includes(body.category) ? body.category : 'for-you';
  const query = String(body.query || '').trim().slice(0,100);
  const prefs = profile?.recommendation_preferences || {};
  const interests = Array.isArray(profile?.interests) ? profile.interests : [];
  let categories = category === 'for-you' ? (Array.isArray(prefs.content_types) ? prefs.content_types : []).filter((value: string) => supported.includes(value)) : [category];
  if (!categories.length) categories = interests.includes('anime') ? ['anime','movie'] : ['movie','tv'];
  categories = [...new Set(categories)];
  const selected = (Array.isArray(prefs.genres) ? prefs.genres : interests).filter((value: string) => genres[value]).slice(0,6);
  const language = ['any','en','ja','ko','hi','fr','es'].includes(prefs.language) ? prefs.language : 'any';
  const requestedRegion = ['NG','GH','ZA','KE','GB','US','CA','IN'].includes(body.region) ? body.region : (prefs.country || 'NG');
  const sources = await Promise.all(categories.map(async (cat: string) => {
    const type = cat === 'movie' ? 'movie' : 'tv';
    const params: Record<string,string> = { include_adult: 'false', language: 'en-US', page: String(page) };
    if (query) params.query = query;
    else {
      params.sort_by = 'popularity.desc'; params['vote_count.gte'] = '50';
      if (selected.length) params.with_genres = [...new Set(selected.map((key: string) => genres[key][type === 'movie' ? 0 : 1]))].join('|');
      if (language !== 'any') params.with_original_language = language;
      if (cat === 'anime') { params.with_genres = '16'; params.with_original_language = 'ja'; }
      const providers = (Array.isArray(prefs.providers) ? prefs.providers : []).filter((id: number) => [8,9,337,350,283].includes(Number(id)));
      if (providers.length) { params.watch_region = requestedRegion; params.with_watch_providers = providers.join('|'); }
    }
    let result = await tmdb(`/${query ? 'search' : 'discover'}/${type}`, params);
    // Some regions have no provider catalogue. Keep taste filters and check
    // streaming availability per title instead of leaving the entire hub empty.
    let availabilityExpanded = false;
    if (!query && params.with_watch_providers && result.total_results === 0) {
      delete params.with_watch_providers; delete params.watch_region;
      result = await tmdb(`/discover/${type}`, params); availabilityExpanded = true;
    }
    return { totalPages: Math.min(500, Number(result.total_pages) || 0), availabilityExpanded,
      items: (result.results || []).filter((item: any) => !item.adult && (cat !== 'anime' || (item.original_language === 'ja' && item.genre_ids?.includes(16))))
        .map((item: any) => ({ ...item, media_type: type, reason: query ? 'Matches your search' : cat === 'anime' ? 'Because you like anime' : selected.length ? `For your ${selected.join(' · ')} interests` : `Popular ${type === 'movie' ? 'movies' : 'series'}` })) };
  }));
  if (!query && category === 'for-you' && Array.isArray(prefs.favorites)) {
    const seed = prefs.favorites.find((item: any) => ['movie','tv'].includes(item.type) && /^\d+$/.test(String(item.id)));
    if (seed) {
      const similar = await tmdb(`/${seed.type}/${seed.id}/recommendations`, { language: 'en-US', page: String(page) }).catch(() => ({ results: [], total_pages: 0 }));
      sources.unshift({ totalPages: Math.min(500, Number(similar.total_pages) || 0), availabilityExpanded: false,
        items: (similar.results || []).filter((item: any) => !item.adult).map((item: any) => ({ ...item, media_type: seed.type, reason: `Because you liked ${String(seed.title).slice(0,100)}` })) });
    }
  }
  const ordered: any[] = [];
  const length = Math.max(0,...sources.map(source => source.items.length));
  for (let index=0; index<length; index++) for (const source of sources) if (source.items[index]) ordered.push(source.items[index]);
  const unique = [...new Map(ordered.map(item => [`${item.media_type}:${item.id}`,item])).values()];
  const hasMore = sources.some(source => source.totalPages > page);
  return { configured: true, page, hasMore, nextPage: hasMore ? page + 1 : null,
    context: query ? `Results for “${query}”` : category === 'for-you' ? 'Picked from your interests and favourite titles' : 'Explore more of what you enjoy',
    availabilityExpanded: sources.some(source => source.availabilityExpanded),
    items: unique.map((item: any) => ({ id: item.id, kind: item.media_type, type: item.media_type, title: item.title || item.name, subtitle: item.overview || '',
      image: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : null,
      backdrop: item.backdrop_path ? `https://image.tmdb.org/t/p/w1280${item.backdrop_path}` : null,
      date: item.release_date || item.first_air_date, rating: item.vote_average, reason: item.reason,
      url: `https://www.themoviedb.org/${item.media_type}/${item.id}` })) };
}
