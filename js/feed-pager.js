// Keep old pages while retrying, and ignore requests from an earlier search.
export class FeedPager {
  constructor() { this.reset(); }
  reset() { this.generation = (this.generation || 0) + 1; this.page = 0; this.items = new Map(); this.loading = false; this.hasMore = true; }
  async next(fetchPage) {
    if (this.loading || !this.hasMore) return null;
    const generation = this.generation, page = this.page + 1; this.loading = true;
    try {
      const data = await fetchPage(page);
      if (generation !== this.generation) return null;
      if (!Array.isArray(data.items)) throw new Error('Recommendations could not load. Please try again.');
      const fresh = data.items.filter(item => {
        const key = `${item.type || item.kind}:${item.id}`;
        if (this.items.has(key)) return false;
        this.items.set(key, item); return true;
      });
      this.page = page; this.hasMore = data.hasMore === true && page < 500;
      return { data, fresh, page };
    } finally { if (generation === this.generation) this.loading = false; }
  }
}
