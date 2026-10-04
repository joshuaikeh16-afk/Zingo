import { animeBrowse, animeMeta } from './anime.ts';
import { cached, upstream, allowedUrl } from './content.ts';
type Fetcher = (path: string, parameters?: Record<string,string>) => Promise<any>;
let animeQueue=Promise.resolve(),lastAnimeRequest=0;
export async function jikan(path: string, params: Record<string,string> = {}) {
  const url = new URL(`https://api.jikan.moe/v4${path}`);
  Object.entries(params).forEach(([key,value])=>url.searchParams.set(key,value));
  return cached(url.href, path==='/seasons'||path==='/genres/anime'?86400:600, async()=>{
    const turn=animeQueue.then(async()=>{const delay=Math.max(0,450-(Date.now()-lastAnimeRequest));if(delay)await new Promise(resolve=>setTimeout(resolve,delay));lastAnimeRequest=Date.now();});
    animeQueue=turn.catch(()=>{});await turn;return (await upstream(url.href)).json();
  });
}
export function animeItem(item: any) {
  return {provider:'mal',kind:'anime',type:'anime',id:item.mal_id,title:item.title_english||item.title,subtitle:item.synopsis||'',image:allowedUrl(item.images?.webp?.large_image_url||item.images?.jpg?.large_image_url,['myanimelist.net']),backdrop:null,date:item.aired?.from,rating:item.score,episodes:item.episodes,genres:(item.genres||[]).map((g:any)=>g.name),themes:(item.themes||[]).map((g:any)=>g.name),url:allowedUrl(item.url,['myanimelist.net']),trailerKey:item.trailer?.youtube_id&&/^[a-zA-Z0-9_-]{11}$/.test(item.trailer.youtube_id)?item.trailer.youtube_id:null};
}
const safeAnime=(item:any)=> !String(item.rating||'').startsWith('Rx') && !(item.genres||[]).some((g:any)=>[9,12,49].includes(g.mal_id));
export async function browseMeta(category:string, tmdb:Fetcher, anime:Fetcher=jikan) {
 if(category==='anime'&&anime===jikan)return animeMeta();
 if(category==='anime'){
  const results=await Promise.allSettled([anime('/genres/anime',{filter:'genres'}),anime('/genres/anime',{filter:'themes'}),anime('/seasons')]);
  const tags=(index:number)=>results[index].status==='fulfilled'?(results[index] as PromiseFulfilledResult<any>).value.data||[]:[];
  const map=(index:number)=>tags(index).filter((g:any)=>![9,12,49].includes(g.mal_id)).map((g:any)=>({id:g.mal_id,name:g.name}));
  return {category,genres:map(0),themes:map(1),years:tags(2),partial:results.some(r=>r.status==='rejected')};
 }
 if(!['movie','tv'].includes(category))throw new RangeError('Invalid category');
 const data=await tmdb(`/genre/${category}/list`,{language:'en-US'});
 return {category,genres:data.genres||[],themes:[],years:[]};
}
export async function browse(body:any,tmdb:Fetcher,anime:Fetcher=jikan){
 const category=body.category,page=Number(body.page??1),query=String(body.query||'').trim().slice(0,100);
 if(!['movie','tv','anime'].includes(category)||!Number.isInteger(page)||page<1||page>500)throw new RangeError('Invalid browse query');
 const genre=/^\d{1,5}$/.test(String(body.genre||''))?String(body.genre):'', theme=/^\d{1,5}$/.test(String(body.theme||''))?String(body.theme):'';
 const year=Number(body.year),hasYear=Number.isInteger(year)&&year>=1870&&year<=9999;
 if(category==='anime'&&anime===jikan)return animeBrowse(body);
 if(category==='anime'){
  if(hasYear&&['winter','spring','summer','fall'].includes(body.season)){
   const data=await anime(`/seasons/${year}/${body.season}`,{page:String(page),limit:'24',sfw:'true'});
   let items=(data.data||[]).filter(safeAnime).filter((item:any)=>(!genre||(item.genres||[]).some((g:any)=>String(g.mal_id)===genre))&&(!theme||(item.themes||[]).some((g:any)=>String(g.mal_id)===theme)));
   if(body.sort==='rating')items.sort((a:any,b:any)=>(b.score||0)-(a.score||0));else items.sort((a:any,b:any)=>(b.members||0)-(a.members||0));
   return {configured:true,category,page,hasMore:!!data.pagination?.has_next_page,items:items.map(animeItem),context:'Provider season archive · genre/theme filters and ranking apply to each loaded page'};
  }
  const params:Record<string,string>={page:String(page),limit:'24',sfw:'true',order_by:body.sort==='rating'?'score':body.sort==='new'?'start_date':'members',sort:'desc'};
  if(query)params.q=query;if(genre||theme)params.genres=[genre,theme].filter(Boolean).join(',');
  if(hasYear)return {configured:true,category,page,hasMore:false,items:[],context:'Choose a provider-listed season to explore this year'};
  if(body.section==='new'){params.order_by='start_date';params.start_date=new Date(Date.now()-90*86400000).toISOString().slice(0,10);}
  const data=await anime('/anime',params);return {configured:true,category,page,hasMore:!!data.pagination?.has_next_page,items:(data.data||[]).filter(safeAnime).map(animeItem),context:'MyAnimeList metadata via Jikan · overlapping genres and themes'};
 }
 const params:Record<string,string>={include_adult:'false',include_video:'false',page:String(page),language:'en-US'};
 const sort=body.sort==='rating'?'vote_average.desc':body.sort==='new'?(category==='movie'?'primary_release_date.desc':'first_air_date.desc'):'popularity.desc';
 let path=`/discover/${category}`;
 if(query){path=`/search/${category}`;params.query=query;}else{
  params.sort_by=sort;if(body.sort==='rating')params['vote_count.gte']='100';
  if(genre)params.with_genres=genre;
  if(['US','NG','IN','KR','JP','CN','GB','FR'].includes(body.cinema))params.with_origin_country=body.cinema;
  if(body.cinema==='IN')params.with_original_language='hi';
  if(body.format==='animation')params.with_genres=[genre,'16'].filter(Boolean).join(',');
  if(body.format==='live-action')params.without_genres='16';
  if(body.format==='documentary')params.with_genres=[genre,'99'].filter(Boolean).join(',');
  const dateKey=category==='movie'?'primary_release_date':'first_air_date';
  if(hasYear){params[`${dateKey}.gte`]=`${year}-01-01`;params[`${dateKey}.lte`]=`${year}-12-31`;}
  const decade=Number(body.decade);if(!hasYear&&Number.isInteger(decade)&&decade>=1880&&decade<=new Date().getUTCFullYear()&&decade%10===0){params[`${dateKey}.gte`]=`${decade}-01-01`;params[`${dateKey}.lte`]=`${decade+9}-12-31`;}
  const today=new Date().toISOString().slice(0,10);
  if(body.section==='upcoming'){params[`${dateKey}.gte`]=today;params.sort_by=`${dateKey}.asc`;}
  if(body.section==='new'){params[`${dateKey}.gte`]=new Date(Date.now()-90*86400000).toISOString().slice(0,10);params[`${dateKey}.lte`]=today;}
  if(category==='tv'&&body.section==='airing'){params['air_date.gte']=new Date(Date.now()-7*86400000).toISOString().slice(0,10);params['air_date.lte']=new Date(Date.now()+7*86400000).toISOString().slice(0,10);}
  if(category==='tv'&&body.section==='completed')params.with_status='3|4';
  if(/^\d{1,5}$/.test(String(body.service||''))){params.with_watch_providers=String(body.service);params.watch_region=/^[A-Z]{2}$/.test(body.region)?body.region:'NG';}
 }
 const data=await tmdb(path,params);
 // Search APIs cannot apply taxonomy filters: the UI shows and explains this mode.
 return {configured:true,category,page,hasMore:page<Math.min(500,data.total_pages||0),context:query?'Title search across this category':'Browse the catalogue · independent of your Home tastes',items:(data.results||[]).filter((i:any)=>!i.adult).map((i:any)=>({provider:'tmdb',kind:category,type:category,id:i.id,title:i.title||i.name,subtitle:i.overview,image:i.poster_path?`https://image.tmdb.org/t/p/w500${i.poster_path}`:null,backdrop:i.backdrop_path?`https://image.tmdb.org/t/p/w1280${i.backdrop_path}`:null,date:i.release_date||i.first_air_date,rating:i.vote_average,url:`https://www.themoviedb.org/${category}/${i.id}`}))};
}
