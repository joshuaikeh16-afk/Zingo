import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FeedPager } from '../js/feed-pager.js';
import { unreadTotal, applyReadMarks, compareMessages } from '../js/unread-state.js';
import { catalog } from '../supabase/functions/_shared/catalog.ts';

test('unread badges sum messages, including numeric strings', () => {
  assert.equal(unreadTotal([{ unreadCount: '7' }, { unreadCount: 3 }]), 10);
});
test('opening a read chat does not hide a newer, unseen message', () => {
  const mark = { id: 'a', created_at: '2026-10-03T10:00:00.001100+00:00' };
  const rows = [{ conversationId: 'chat', unreadCount: 7, lastMessage: mark }];
  assert.equal(applyReadMarks(rows,new Map([['chat',mark]]))[0].unreadCount,0);
  assert.equal(applyReadMarks([{...rows[0],lastMessage:{...mark,created_at:'2026-10-03T10:00:00.001200Z'}}],new Map([['chat',mark]]))[0].unreadCount,7);
  assert(compareMessages({ ...mark, created_at: '2026-10-03T10:00:00.001100Z' },mark)===0);
});
test('pagination retries the same page and keeps existing cards without duplicates', async () => {
  const feed = new FeedPager(), first = { id:1,type:'movie' }, second = { id:2,type:'movie' };
  await feed.next(async page => ({ items:[first],hasMore:true,page }));
  await assert.rejects(feed.next(async () => { throw new Error('Offline'); }));
  assert.equal(feed.page,1); assert.equal(feed.items.size,1);
  const next = await feed.next(async page => { assert.equal(page,2); return {items:[first,second],hasMore:false}; });
  assert.deepEqual(next.fresh,[second]); assert.equal(feed.items.size,2); assert.equal(feed.hasMore,false);
});
test('an older search cannot replace a new search or clear its loading state', async () => {
  const feed=new FeedPager(); let releaseOld,releaseNew;
  const old=feed.next(()=>new Promise(resolve=>{releaseOld=resolve;}));
  feed.reset(); const current=feed.next(()=>new Promise(resolve=>{releaseNew=resolve;}));
  releaseOld({items:[{id:1,type:'movie'}],hasMore:true}); assert.equal(await old,null); assert.equal(feed.loading,true);
  releaseNew({items:[{id:2,type:'tv'}],hasMore:false}); await current; assert.equal(feed.items.size,1); assert.equal(feed.items.values().next().value.id,2);
});
test('real provider paging uses tastes, favourites and the requested page', async () => {
  const calls=[];
  const response=await catalog({category:'for-you',page:2,region:'NG'}, { recommendation_preferences:{content_types:['movie'],genres:['action'],favorites:[{id:10,type:'movie',title:'A favourite'}]} }, async(path,params)=>{
    calls.push({path,params}); return {total_pages:3,total_results:30,results:[{id:path.includes('recommendations')?1:2,title:'Pick',genre_ids:[28],vote_average:8}]};
  });
  assert.equal(response.page,2); assert.equal(response.hasMore,true); assert.equal(response.nextPage,3);
  assert(calls.every(call=>call.params.page==='2')); assert.equal(calls.find(call=>call.path==='/discover/movie').params.with_genres,'28'); assert(response.items[0].reason.includes('A favourite'));
});
test('empty regional provider coverage expands availability while preserving interests', async () => {
  const calls=[];
  const response=await catalog({category:'movie',page:1,region:'NG'}, {recommendation_preferences:{genres:['comedy'],providers:[8]}},async(path,params)=>{
    calls.push({...params}); return params.with_watch_providers?{total_pages:0,total_results:0,results:[]}:{total_pages:1,total_results:1,results:[{id:3,title:'A comedy'}]};
  });
  assert.equal(calls.length,2); assert.equal(calls[1].with_genres,'35'); assert.equal(calls[1].with_watch_providers,undefined); assert.equal(response.items.length,1); assert.equal(response.availabilityExpanded,true); assert.equal(response.hasMore,false);
});
