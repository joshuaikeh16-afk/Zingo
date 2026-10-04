import { renderSportsHub } from './sports.js';
import { account } from './session.js';
import { element, actionButton, artwork, skeletons, emptyState } from './ui.js';
import { contentRequest, clearContentCache, feedError, renderNews } from './content-client.js';
import { mediaCard, categories } from './media.js';
import { matchCard, matchContent, openContent, matchVisual } from './content-view.js';
import { goRoute, parseRoute } from './router.js';
import { FeedPager } from './feed-pager.js';
const grid = document.getElementById('discover-grid'), hero = document.getElementById('discover-hero'), filters = document.getElementById('discover-filters'), search = document.getElementById('content-search'), region = document.getElementById('content-region'), more = document.getElementById('load-discover-more'), status = document.getElementById('discover-page-status');
const names = { movie: 'Movies', tv: 'Series', anime: 'Anime', sports: 'Sports' };
const sections = { anime: [['genres', 'Genres'], ['seasons', 'Seasons'], ['themes', 'Themes'], ['new', 'New'], ['popular', 'Popular']], movie: [['genres', 'Genres'], ['cinema', 'Cinema'], ['style', 'Style'], ['years', 'Years'], ['new', 'New releases'], ['upcoming', 'Upcoming'], ['popular', 'Popular']], tv: [['genres', 'Genres'], ['airing', 'Currently airing'], ['completed', 'Completed'], ['years', 'Release years'], ['services', 'Services'], ['popular', 'Popular']], football: [['for-you', 'For you'], ['live', 'Live'], ['fixtures', 'Fixtures'], ['competitions', 'Competitions'], ['clubs', 'Clubs'], ['news', 'News']] };
const cinemas = [['US', 'Hollywood · US'], ['IN', 'Bollywood · Hindi cinema'], ['NG', 'Nollywood · Nigeria'], ['KR', 'Korean cinema'], ['JP', 'Japanese cinema'], ['CN', 'Chinese cinema'], ['GB', 'British cinema'], ['FR', 'French cinema']];
let route = { view: 'discover', path: 'discover' }, version = 0, loadedPath, metadata = {}, footballData = [], pager = new FeedPager(), loading = false;
function destination(category, section = 'popular', values = {}) { const params = new URLSearchParams(Object.entries(values).filter(([, value]) => value !== '' && value != null)); return `discover/${category}/${section}${params.size ? '?' + params : ''}`; }
function update(values) { goRoute(destination(route.category, route.section, { ...route.filters, ...values })); }
for (const item of categories.filter(item => item.enabled && item.id !== 'for-you')) {
    const button = actionButton(item.label, item.icon);
    button.dataset.category = item.id;
    button.addEventListener('click', () => goRoute(destination(item.id, item.id === 'sports' ? 'for-you' : 'popular')));
    document.getElementById('content-categories').append(button);
}
function select(key, label, options, { empty = 'Any', value = route.filters?.[key] } = {}) {
    const row = element('label', 'browse-select', label), input = element('select');
    input.setAttribute('aria-label', label);
    input.dataset.filter = key;
    for (const [id, name] of [['', empty], ...options]) {
        const option = element('option', '', name);
        option.value = id;
        input.append(option);
    }
    input.value = value || '';
    input.addEventListener('change', () => update({ [key]: input.value, ...(key === 'year' && route.category === 'anime' ? { season: '' } : {}), ...(key === 'year' ? { decade: '' } : {}), ...(key === 'decade' ? { year: '' } : {}) }));
    row.append(input);
    filters.append(row);
    return input;
}
function renderControls() {
    const category = route.category, values = route.filters || {};
    filters.replaceChildren();
    const nav = document.getElementById('discover-sections');
    nav.replaceChildren();
    document.querySelectorAll('#content-categories button').forEach(button => { button.classList.toggle('active', button.dataset.category === category); button.setAttribute('aria-pressed', String(button.dataset.category === category)); });
    for (const [id, label] of sections[category] || []) {
        const button = element('button', id === route.section ? 'active' : '', label);
        button.type = 'button';
        button.setAttribute('aria-pressed', String(id === route.section));
        button.addEventListener('click', () => goRoute(destination(category, id, { ...values, query: '' })));
        nav.append(button);
    }
    if (!category || ['football','sports'].includes(category))
        return;
    if (metadata.genres?.length)
        select('genre', 'Genre', metadata.genres.map(g => [g.id, g.name]));
    if (category === 'anime') {
        if (metadata.themes?.length)
            select('theme', 'Theme', metadata.themes.map(g => [g.id, g.name]));
        if (route.section === 'seasons' || values.year) {
            select('year', 'Year', (metadata.years || []).map(y => [y.year, String(y.year)]), { empty: 'Choose a year' });
            const year = (metadata.years || []).find(y => String(y.year) === String(values.year));
            select('season', 'Season', (year?.seasons || []).map(s => [s, s[0].toUpperCase() + s.slice(1)]), { empty: 'Choose a season' });
        }
    }
    else {
        if (category === 'movie') {
            select('cinema', 'Cinema / origin', cinemas);
            select('format', 'Style', [['animation', 'Animation'], ['live-action', 'Live action'], ['documentary', 'Documentary']]);
        }
        if (route.section === 'years' || values.year || values.decade) {
            const current = new Date().getFullYear();
            select('year', 'Release year', Array.from({ length: current - 1887 }, (_, i) => [current - i, String(current - i)]));
            select('decade', 'Decade', Array.from({ length: Math.floor((current - 1880) / 10) + 1 }, (_, i) => [Math.floor(current / 10) * 10 - i * 10, `${Math.floor(current / 10) * 10 - i * 10}s`]));
        }
        if (category === 'tv' && route.section === 'services')
            select('service', 'Streaming service', [[8, 'Netflix'], [9, 'Prime Video'], [350, 'Apple TV'], [337, 'Disney+'], [283, 'Crunchyroll']]);
    }
    select('sort', 'Sort', [['popular', 'Popular'], ['rating', values.season ? 'Rating on each page' : 'Top rated'], ['new', 'Newest']], { empty: 'Popular' });
    if (Object.values(values).some(Boolean)) {
        const clear = actionButton('Reset filters', 'close');
        clear.addEventListener('click', () => goRoute(destination(category, route.section)));
        filters.append(clear);
    }
    if (values.query && category !== 'anime') {
        filters.querySelectorAll('select').forEach(input => input.disabled = true);
        filters.append(element('p', 'browse-note', 'Title search is separate from taxonomy filters. Clear the search to browse with filters.'));
    }
    if (category === 'movie' && values.cinema)
        filters.append(element('p', 'browse-note', 'Cinema groups use production origin. Bollywood also uses Hindi language metadata. These are not genres.'));
    if (metadata.partial)
        filters.append(element('p', 'browse-note', 'Some archive filters could not load. Titles remain available.'));
}
function heading() {
    const values = route.filters || {}, category = route.category;
    let title = names[category] || 'Find your next world';
    const genre = metadata.genres?.find(g => String(g.id) === values.genre)?.name, theme = metadata.themes?.find(g => String(g.id) === values.theme)?.name;
    if (values.cinema)
        title = cinemas.find(([code]) => code === values.cinema)?.[1] || title;
    if (values.format)
        title = { animation: 'Animated movies', 'live-action': 'Live action', documentary: 'Documentaries' }[values.format] || title;
    if (category === 'anime' && values.year)
        title = `${values.season ? values.season[0].toUpperCase() + values.season.slice(1) : 'Anime in'} ${values.year}`;
    if (genre)
        title = `${genre} · ${title}`;
    if (theme)
        title = `${theme} · ${title}`;
    if (values.query)
        title = `Results for “${values.query}”`;
    return title;
}
function banner(items = [], match) {
    hero.replaceChildren();
    hero.dataset.category = route.category || 'all';
    hero.setAttribute('aria-busy', 'false');
    const copy = element('div', 'discover-hero-copy');
    copy.append(element('p', 'eyebrow', route.category ? `Discover / ${names[route.category]}` : 'ENTERTAINMENT STARTS HERE'), element('h2', '', match ? `${match.home} vs ${match.away}` : heading()), element('p', '', match ? `${match.competitionName} · ${new Date(match.utcDate).toLocaleString()}` : route.category === 'anime' ? 'Genres, real themes, and seasons worth returning to.' : 'Explore something new. Bring it into the conversation.'));
    if (match) {
        hero.classList.add('match-hero');
        const view = actionButton('Enter match', 'ball', 'primary-button');
        view.addEventListener('click', () => openContent(matchContent(match)));
        copy.append(view);
        hero.append(matchVisual(match));
    }
    else {
        hero.classList.remove('match-hero');
        const item = items.find(item => item.backdrop) || items.find(item => item.image);
        hero.classList.toggle('anime-cover-fallback', route.category === 'anime' && !!item && !item.backdrop);
        if (item) {
            if (item.backdrop || route.category !== 'anime') hero.append(artwork(item.backdrop || item.image, '', 'discover-backdrop', true));
            else { const collage = element('div', 'anime-cover-art'); for (const title of items.filter(title => title.image).slice(0, 3)) collage.append(artwork(title.image, '', 'anime-hero-cover', true)); hero.append(collage); }
            if (item.image)
                hero.append(artwork(item.image, '', 'discover-poster', true));
        }
    }
    hero.append(copy);
}
async function landing(generation) {
    metadata = {};
    renderControls();
    const hubs = document.getElementById('discover-hubs');
    hubs.replaceChildren();
    for (const [key, title] of Object.entries(names)) {
        const button = actionButton(title, { movie: 'film', tv: 'tv', anime: 'spark', sports: 'ball' }[key], 'hub-card');
        button.dataset.hub = key;
        button.append(element('small', '', { movie: 'Stories, cinema, decades', tv: 'New obsessions, returning favourites', anime: 'Genres, themes, season archives', sports: 'Clubs, matches, your people' }[key]));
        button.addEventListener('click', () => goRoute(destination(key, key === 'sports' ? 'for-you' : 'popular')));
        hubs.append(button);
    }
    const data = await contentRequest('browse', { category: 'movie', page: 1 });
    if (generation !== version)
        return;
    banner(data.items || []);
    document.getElementById('discover-heading').textContent = 'Popular in the catalogue';
    document.getElementById('discover-context').textContent = 'Choose a world above to explore its genres, years and stories.';
    grid.replaceChildren(...(data.items || []).slice(0, 12).map(mediaCard));
    if (!data.configured)
        feedError(grid, () => load(true), 'Movies are unavailable. Other category hubs can still be opened.');
    document.getElementById('discover-more').classList.add('hidden');
}
function footballSection(label, items) { if (!items.length)
    return; const section = element('section', 'football-section'); section.append(element('h3', '', label)); const list = element('div', 'football-cards'); list.append(...items.slice(0, 6).map(matchCard)); section.append(list); grid.append(section); }
async function footballHub(generation) {
    const values = route.filters || {}, section = route.section || 'for-you';
    document.getElementById('discover-more').classList.add('hidden');
    if (section === 'news') {
        banner();
        try {
            const news = await contentRequest('news', { kind: 'football' });
            if (generation === version) {
                grid.replaceChildren();
                renderNews(grid, news.items);
            }
        }
        catch {
            if (generation === version)
                feedError(grid, () => load(true), 'Football news is unavailable. Try another football section.');
        }
        return;
    }
    const response = await contentRequest('fixtures');
    if (generation !== version)
        return;
    footballData = response.matches || [];
    grid.replaceChildren();
    if (!response.configured) {
        banner();
        feedError(grid, () => load(true), 'Football data is temporarily unavailable.');
        return;
    }
    const current = await account;
    if (generation !== version)
        return;
    const prefs = current?.profile.recommendation_preferences || {}, clubs = prefs.football_clubs || [], competitions = prefs.football_competitions || [];
    let matches = footballData.filter(m => (!values.competition || m.competition === values.competition) && (!values.club || [String(m.homeId), String(m.awayId)].includes(values.club)));
    filters.replaceChildren();
    const competitionOptions = [...new Map(footballData.map(m => [m.competition, m.competitionName])).entries()];
    select('competition', 'Competition', competitionOptions);
    const clubOptions = [...new Map(footballData.flatMap(m => [[m.homeId, m.home], [m.awayId, m.away]])).entries()].filter(([id]) => id);
    select('club', 'Club', clubOptions);
    if (section === 'competitions' || section === 'clubs') {
        const target = element('div', 'football-directory');
        for (const [id, name] of section === 'competitions' ? competitionOptions : clubOptions) {
            const button = actionButton(name, 'ball');
            button.addEventListener('click', () => goRoute(destination('football', 'fixtures', { [section === 'competitions' ? 'competition' : 'club']: id })));
            target.append(button);
        }
        grid.append(target);
    }
    const live = matches.filter(m => ['IN_PLAY', 'PAUSED', 'EXTRA_TIME', 'PENALTY_SHOOTOUT'].includes(m.status));
    const relevant = matches.filter(m => clubs.some(id => [m.homeId, m.awayId].includes(Number(id))) || competitions.includes(m.competition));
    const featured = live[0] || relevant.find(m => m.status !== 'FINISHED') || matches.find(m => m.status !== 'FINISHED') || matches[0];
    banner([], featured);
    if (section === 'live')
        footballSection('Live now', live);
    else if (section === 'for-you') {
        footballSection('Your clubs & competitions', relevant);
        footballSection('Live now', live);
        footballSection('Next up', matches.filter(m => ['TIMED', 'SCHEDULED'].includes(m.status)));
        footballSection('Recent results', matches.filter(m => m.status === 'FINISHED'));
    }
    else {
        footballSection('Today', matches.filter(m => new Date(m.utcDate).toDateString() === new Date().toDateString()));
        footballSection('Upcoming', matches.filter(m => ['TIMED', 'SCHEDULED'].includes(m.status)));
        footballSection('Results', matches.filter(m => m.status === 'FINISHED'));
    }
    if (!grid.childElementCount)
        grid.append(emptyState('No matches here right now', 'Change competition or check upcoming fixtures.', 'ball'));
    document.getElementById('discover-heading').textContent = section === 'live' ? 'Live now' : 'Matchday, together';
    document.getElementById('discover-context').textContent = 'Provider fixtures and scores · sections show up to six matches at a time';
    const all = element('details', 'all-fixtures');
    all.append(element('summary', '', `All ${matches.length} matches`));
    let shown = 0;
    const list = element('div', 'football-cards'), next = actionButton('More matches', 'arrow');
    const append = () => { list.append(...matches.slice(shown, shown + 12).map(matchCard)); shown += 12; next.hidden = shown >= matches.length; };
    all.addEventListener('toggle', () => { if (all.open && !shown)
        append(); });
    next.addEventListener('click', append);
    all.append(list, next);
    grid.append(all);
}
function seasonDirectory(){
    if(route.category!=='anime'||route.section!=='seasons'||route.filters?.season||route.filters?.query)return false;
    const year=(metadata.years||[]).find(item=>String(item.year)===route.filters?.year);
    grid.replaceChildren();banner();document.getElementById('discover-more').classList.add('hidden');
    document.getElementById('discover-heading').textContent=year?`Seasons in ${year.year}`:'Explore the season archive';
    document.getElementById('discover-context').textContent=metadata.archiveCalendar ? 'Browse calendar seasons within the provider’s catalogue years. Empty seasons are shown honestly.' : 'Years and available seasons come directly from the provider archive.';
    const directory=element('div','season-directory');grid.append(directory);
    if(year){for(const season of year.seasons){const button=actionButton(season[0].toUpperCase()+season.slice(1),'spark','archive-card');button.addEventListener('click',()=>update({season}));directory.append(button);}}
    else{const years=metadata.years||[];let shown=0;const moreYears=actionButton('Earlier years','arrow');function append(){for(const item of years.slice(shown,shown+32)){const button=actionButton(String(item.year),'spark','archive-card');button.append(element('small','',item.seasons.map(season=>season[0].toUpperCase()+season.slice(1)).join(' · ')));button.addEventListener('click',()=>update({year:String(item.year),season:''}));directory.append(button);}shown+=32;moreYears.hidden=shown>=years.length;}append();moreYears.addEventListener('click',append);grid.append(moreYears);if(!years.length)grid.append(emptyState('Archive unavailable','Reopen this section to retry the provider archive. Other anime sections remain available.','spark'));}
    grid.setAttribute('aria-busy','false');return true;
}
async function next() {
    if (loading || !pager.hasMore || !route.category || ['football','sports'].includes(route.category) || route.category==='anime'&&route.section==='seasons'&&!route.filters?.season&&!route.filters?.query)
        return;
    loading = true;
    more.disabled = true;
    const generation = version;
    try {
        const result = await pager.next(page => contentRequest('browse', { category: route.category, section: route.section, ...route.filters, region: region.value, page }));
        if (!result || generation !== version)
            return;
        if (result.page === 1) {
            grid.replaceChildren();
            banner(result.data.items);
        }
        grid.append(...result.fresh.map(mediaCard));
        if (!pager.items.size)
            grid.replaceChildren(emptyState('No titles on this page', result.data.hasMore ? 'The archive has more pages. Continue browsing, or broaden your filters.' : 'Try different filters or search for a title.', 'search'));
        if (!result.data.configured)
            feedError(grid, () => load(true), 'This category is unavailable right now. Other categories still work.');
        document.getElementById('discover-heading').textContent = heading();
        document.getElementById('discover-context').textContent = result.data.context || 'Explore the catalogue';
        document.getElementById('discover-count').textContent = `${pager.items.size} titles`;
        more.hidden = !pager.hasMore;
        status.textContent = pager.hasMore ? 'More titles are available' : 'You’ve reached the end of these results';
        more.textContent = 'More titles';
    }
    catch (error) {
        if (generation === version) {
            if (!pager.page) {
                banner();
                feedError(grid, () => load(true), error.message);
            }
            else
                status.textContent = 'Could not load the next page. Your titles are still here.';
            more.hidden = false;
            more.textContent = 'Try again';
        }
    }
    finally {
        if (generation === version) {
            loading = false;
            more.disabled = false;
            grid.setAttribute('aria-busy', 'false');
        }
    }
}
async function load(force = false) {
    const nextRoute = parseRoute(location.hash);
    if (nextRoute.view !== 'discover')
        return;
    if (!force && loadedPath === nextRoute.path)
        return;
    if (force)
        clearContentCache();
    route = nextRoute;
    loadedPath = route.path;
    const generation = ++version;
    pager.reset();
    loading = false;
    document.getElementById('content-search-form').classList.toggle('hidden',nextRoute.category==='sports');
    search.value = route.filters?.query || '';
    document.getElementById('discover-count').textContent = '';
    document.getElementById('discover-hubs').classList.toggle('hidden', !!route.category);
    document.getElementById('discover-more').classList.remove('hidden');
    hero.className='discover-hero';grid.classList.remove('sports-grid');
    skeletons(hero, 'hero', 1);
    skeletons(grid, 'media', 6);
    try {
        if (!route.category)
            return await landing(generation);
        metadata = {};
        renderControls();
        if (route.category === 'sports') return await renderSportsHub(route);
        if (route.category === 'football')
            return await footballHub(generation);
        const meta = contentRequest('browse-meta', { category: route.category }).then(data => { if (generation === version) {
            metadata = data;
            renderControls();
            if(seasonDirectory())return;
            if (pager.page) {
                banner([...pager.items.values()]);
                document.getElementById("discover-heading").textContent = heading();
            }
        } }).catch(() => { if (generation === version)
            {filters.append(element('p', 'browse-note', 'Filters could not load. Title browsing still works.'));if(route.category==='anime'&&route.section==='seasons'&&!route.filters?.season&&!route.filters?.query){banner();feedError(grid,()=>load(true),'Season archive could not load. Try again or choose another anime section.');}} });
        await Promise.all([meta, next()]);
    }
    catch (error) {
        if (generation === version) {
            banner();
            feedError(grid, () => load(true), error.message || 'This section could not load. Try another category.');
        }
    }
    finally {
        if (generation === version)
            grid.setAttribute('aria-busy', 'false');
    }
}
more.addEventListener('click', next);
document.getElementById('content-search-form').addEventListener('submit', event => { event.preventDefault(); const nextPath = destination(route.category && route.category !== 'football' ? route.category : 'movie', route.category && route.category !== 'football' ? route.section : 'popular', { ...route.filters, ...(route.category==='anime'&&search.value.trim()?{year:'',season:''}:{}),query: search.value.trim() }); if (nextPath === route.path)
    load(true);
else
    goRoute(nextPath); });
region.addEventListener('change', () => load(true));
document.addEventListener('kaidra:route-change', event => { if (event.detail.view === 'discover')
    load(); });
document.addEventListener('kaidra:discover-refresh', () => load(true));
(async () => { await account; if (parseRoute(location.hash).view === 'discover')
    load(); })();
