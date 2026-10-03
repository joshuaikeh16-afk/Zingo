import { attachContentActions } from './content-actions.js';
import { supabase } from './supabase-client.js';
import { element, safeUrl, artwork, actionButton, emptyState } from './ui.js';
export const platforms = [
  { name: 'Netflix', url: 'https://www.netflix.com/', description: 'Movies & series', symbol: 'N' },
  { name: 'Prime Video', url: 'https://www.primevideo.com/', description: 'Movies & series', symbol: '▶' },
  { name: 'Apple TV', url: 'https://tv.apple.com/', description: 'Films & originals', symbol: 'tv' },
  { name: 'Disney+', url: 'https://www.disneyplus.com/', description: 'Films & series · select regions', symbol: 'D+' },
  { name: 'Crunchyroll', url: 'https://www.crunchyroll.com/', description: 'Anime', symbol: 'C' },
];
export const highlights = [
  { name: 'FIFA+', url: 'https://www.plus.fifa.com/en', description: 'Official match highlights & archive', symbol: 'F' },
  { name: 'UEFA.tv', url: 'https://www.uefa.tv/', description: 'Official UEFA highlights', symbol: 'U' },
  { name: 'Premier League', url: 'https://www.premierleague.com/en/video/highlights', description: 'Official league highlights', symbol: 'PL' },
];
export async function contentRequest(action, payload = {}) {
  const { data, error } = await supabase.functions.invoke('content-api', { body: { action, ...payload } });
  if (error || data?.error) {
    let details = data;
    if (error?.context && typeof error.context.json === 'function') {
      try { details = await error.context.clone().json(); } catch { /* A network error has no JSON body. */ }
    }
    const status = error?.context?.status;
    console.warn(`Content feed ${action} failed`, { status, code: details?.code });
    throw new Error(status === 401 ? 'Your session has expired. Sign in again to continue.' : status === 404 ? 'This feed is not available yet. Please try again shortly.' : details?.error || 'This feed is temporarily unavailable. Please try again.');
  }
  return data;
}
export function externalLink(label, url, className = 'quiet-button') {
  const link = element('a', className, label);
  const href = safeUrl(url);
  if (href) link.href = href;
  else link.setAttribute('aria-disabled', 'true');
  link.target = '_blank'; link.rel = 'noopener noreferrer';
  return link;
}
export function renderPlatforms(target, items) {
  if (!target) return;
  target.replaceChildren(...items.map((item) => {
    const link = externalLink('', item.url, 'platform-card');
    const copy = element('span');
    copy.append(element('strong', '', item.name), element('small', '', item.description));
    link.append(element('span', 'platform-symbol', item.symbol), copy, element('span', 'external-arrow', '↗'));
    return link;
  }));
}
export function renderNews(target, items) {
  target.replaceChildren();
  if (!items.length) target.append(emptyState('All caught up.', 'Fresh stories will appear here when available.', 'book'));
  items.forEach((item) => {
    const article = element('article', 'news-card');
    if (item.image) article.append(artwork(item.image, '', 'news-image'));
    article.append(element('p', 'news-source', `${item.source}${item.publishedAt ? ` · ${new Date(item.publishedAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}` : ''}`));
    const headline = element('button', 'news-headline', item.title); headline.type = 'button';
    headline.addEventListener('click', () => document.dispatchEvent(new CustomEvent('kaidra:open-content', { detail: { ...item, kind: 'article' } }))); article.append(headline);
    if (item.summary) article.append(element('p', 'news-summary', item.summary));
    attachContentActions(article, { ...item, kind: 'article' }); target.append(article);
  });
}
export function feedError(target, retry, message = 'This feed is temporarily unavailable.') {
  const box = element('div', 'feed-notice');
  box.append(element('p', '', message));
  if (retry) { const button = actionButton('Try again', 'refresh'); button.addEventListener('click', retry); box.append(button); }
  target.replaceChildren(box);
}
