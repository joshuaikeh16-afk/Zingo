// ==========================================================================
// Kaidra — /api/news
// Server-side RSS aggregation. Runs on Vercel (Node serverless function),
// which avoids the CORS wall that blocks fetching these feeds directly
// from the browser. Each feed is fetched independently (Promise.allSettled)
// so one dead source doesn't take the others down with it.
//
// Category coverage is intentionally broader than just anime -- it mirrors
// the interest tags from onboarding (anime, news, gaming, idols_music,
// art_manga, vtubers) so a general-audience user (not just anime fans)
// gets a feed that's actually relevant to them.
//
// KNOWN GAP: there is no confirmed, reliable public RSS feed for VTuber
// news specifically. It currently reuses the anime feed, tagged under the
// vtubers category, so the filter isn't empty -- swap in a dedicated
// source when one is found and verified working.
// ==========================================================================

const FEEDS = [
  { category: 'anime', categoryLabel: 'Anime', badgeColor: 'pink', url: 'https://www.animenewsnetwork.com/all/rss.xml' },
  { category: 'news', categoryLabel: 'World News', badgeColor: 'cyan', url: 'https://feeds.bbci.co.uk/news/rss.xml' },
  { category: 'gaming', categoryLabel: 'Gaming', badgeColor: 'purple', url: 'https://www.theverge.com/games/rss/index.xml' },
  { category: 'idols_music', categoryLabel: 'Idols & Music', badgeColor: 'cyan', url: 'https://www.altpress.com/feed/' },
  { category: 'art_manga', categoryLabel: 'Art & Manga', badgeColor: 'purple', url: 'https://www.animenewsnetwork.com/manga/rss.xml' },
  { category: 'vtubers', categoryLabel: 'VTubers', badgeColor: 'pink', url: 'https://www.animenewsnetwork.com/all/rss.xml' },
];

const PER_FEED_LIMIT = 4;
const FALLBACK_IMAGE = 'https://images.unsplash.com/photo-1611162617474-5b21e879e113?auto=format&fit=crop&w=800&q=80';

function extractTag(xml, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = xml.match(re);
  if (!m) return '';
  return m[1].replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '').trim();
}

function extractItems(xml) {
  return xml.match(/<item[\s\S]*?<\/item>/gi) || [];
}

function extractImage(itemXml) {
  let m = itemXml.match(/<media:thumbnail[^>]*url="([^"]+)"/i);
  if (m) return m[1];
  m = itemXml.match(/<media:content[^>]*url="([^"]+)"/i);
  if (m) return m[1];
  m = itemXml.match(/<enclosure[^>]*url="([^"]+)"[^>]*type="image[^"]*"/i);
  if (m) return m[1];
  m = itemXml.match(/<img[^>]*src="([^"]+)"/i);
  if (m) return m[1];
  return null;
}

function stripHtml(str) {
  return str.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function timeAgo(dateStr) {
  const then = new Date(dateStr).getTime();
  if (isNaN(then)) return '';
  const diffMs = Date.now() - then;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function slugify(str) {
  return (str || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 60);
}

async function fetchFeed(feed) {
  const res = await fetch(feed.url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; KaidraNewsBot/1.0; +https://zingo-eight.vercel.app)',
      'Accept': 'application/rss+xml, application/xml, text/xml, */*',
    },
  });
  if (!res.ok) throw new Error(`${feed.url} responded ${res.status}`);

  const xml = await res.text();
  const items = extractItems(xml).slice(0, PER_FEED_LIMIT);

  return items.map((block) => {
    const title = stripHtml(extractTag(block, 'title'));
    const link = extractTag(block, 'link') || (block.match(/<link[^>]*href="([^"]+)"/i) || [])[1] || '';
    const pubDate = extractTag(block, 'pubDate') || extractTag(block, 'published') || extractTag(block, 'dc:date');
    const rawDesc = extractTag(block, 'description') || extractTag(block, 'summary') || extractTag(block, 'content:encoded');
    const snippet = stripHtml(rawDesc).slice(0, 160);
    const image = extractImage(block);

    return {
      id: `${feed.category}-${slugify(title)}`,
      title: title || 'Untitled',
      category: feed.category,
      categoryLabel: feed.categoryLabel,
      badgeColor: feed.badgeColor,
      author: feed.categoryLabel,
      sourceUrl: link,
      timeAgo: timeAgo(pubDate),
      coverImage: image || FALLBACK_IMAGE,
      snippet,
      relatedAnimeId: null,
      relatedAnimeTitle: null,
    };
  });
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=1200');

  const results = await Promise.allSettled(FEEDS.map(fetchFeed));

  const articles = results
    .filter((r) => r.status === 'fulfilled')
    .flatMap((r) => r.value);

  const failedFeeds = results
    .map((r, i) => (r.status === 'rejected' ? { url: FEEDS[i].url, reason: String(r.reason) } : null))
    .filter(Boolean);

  if (articles.length === 0) {
    res.status(502).json({ error: 'All feeds failed', failedFeeds });
    return;
  }

  res.status(200).json({ articles, failedFeeds });
};
