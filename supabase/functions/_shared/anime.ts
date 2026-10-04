import { cached, allowedUrl } from './content.ts';
type Query = (query:string,variables?:Record<string,unknown>)=>Promise<any>;
const fields=`id idMal title{english romaji} description(asHtml:false) bannerImage coverImage{extraLarge large} startDate{year month day} averageScore episodes genres tags{name isAdult} season seasonYear siteUrl trailer{id site} externalLinks{site url type}`;
export async function animeGraphql(query:string,variables:Record<string,unknown>={}) {
 return cached(`anilist:${query}:${JSON.stringify(variables)}`,query.includes('GenreCollection')?86400:600,async()=>{
  let response:Response;
  try {response=await fetch('https://graphql.anilist.co',{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify({query,variables}),signal:AbortSignal.timeout(12000)});}
  catch(error){throw Object.assign(new Error('Anime provider could not be reached'),{code:error instanceof Error&&['TimeoutError','AbortError'].includes(error.name)?'UPSTREAM_TIMEOUT':'UPSTREAM_NETWORK'});}
  if(!response.ok)throw Object.assign(new Error(response.status===429?'Anime provider is busy. Please try again shortly.':'Anime provider is temporarily unavailable'),{code:`UPSTREAM_HTTP_${response.status}`});
  const body=await response.json();if(body.errors?.length||!body.data)throw Object.assign(new Error('Anime provider could not complete this request'),{code:'UPSTREAM_GRAPHQL'});return body.data;
 });
}
export function anilistItem(item:any) {
 const date=item.startDate?.year?`${item.startDate.year}-${String(item.startDate.month||1).padStart(2,'0')}-${String(item.startDate.day||1).padStart(2,'0')}`:null;
 return {provider:'mal',kind:'anime',type:'anime',id:item.idMal,artworkProvider:'anilist',artworkId:item.id,title:item.title?.english||item.title?.romaji,subtitle:String(item.description||'').replace(/<[^>]*>/g,''),image:allowedUrl(item.coverImage?.extraLarge||item.coverImage?.large,['anilist.co']),backdrop:allowedUrl(item.bannerImage,['anilist.co']),date,rating:item.averageScore?item.averageScore/10:null,episodes:item.episodes,genres:item.genres||[],themes:(item.tags||[]).filter((t:any)=>!t.isAdult).map((t:any)=>t.name),season:item.season?.toLowerCase(),year:item.seasonYear,url:`https://myanimelist.net/anime/${item.idMal}`,trailerKey:item.trailer?.site==='youtube'&&/^[a-zA-Z0-9_-]{11}$/.test(item.trailer.id)?item.trailer.id:null,streaming:(item.externalLinks||[]).filter((l:any)=>l.type==='STREAMING').map((l:any)=>({name:l.site,url:allowedUrl(l.url,['crunchyroll.com','netflix.com','primevideo.com','hulu.com','disneyplus.com','youtube.com','hidive.com'])})).filter((l:any)=>l.url)};
}
export async function animeMeta(query:Query=animeGraphql) {
 const data=await query(`{GenreCollection MediaTagCollection{name isAdult category} oldest:Page(perPage:1){media(type:ANIME,isAdult:false,startDate_greater:18000000,sort:START_DATE){seasonYear startDate{year}}} newest:Page(perPage:1){media(type:ANIME,isAdult:false,startDate_greater:18000000,sort:START_DATE_DESC){seasonYear startDate{year}}}}`);
 const earliest=data.oldest?.media?.[0]?.seasonYear||data.oldest?.media?.[0]?.startDate?.year,latest=data.newest?.media?.[0]?.seasonYear||data.newest?.media?.[0]?.startDate?.year;
 // Calendar navigation bounded by actual provider records. Availability is checked by each season request.
 const years=Number.isInteger(earliest)&&Number.isInteger(latest)&&latest>=earliest?Array.from({length:Math.min(300,latest-earliest+1)},(_,i)=>({year:latest-i,seasons:['winter','spring','summer','fall']})):[];
 return {category:'anime',source:'AniList',genres:(data.GenreCollection||[]).filter((name:string)=>name!=='Hentai').map((name:string)=>({id:`al:genre:${name}`,name})),themes:(data.MediaTagCollection||[]).filter((tag:any)=>!tag.isAdult).map((tag:any)=>({id:`al:tag:${tag.name}`,name:tag.name,category:tag.category})),years,archiveCalendar:true,partial:!years.length};
}
export async function animeBrowse(body:any,query:Query=animeGraphql) {
 const page=Number(body.page??1),search=String(body.query||'').trim().slice(0,100),year=Number(body.year),hasYear=Number.isInteger(year)&&year>=1870&&year<=9999;
 if(!Number.isInteger(page)||page<1||page>500)throw new RangeError('Invalid browse page');
 if(hasYear&&!['winter','spring','summer','fall'].includes(body.season))return {configured:true,category:'anime',page,hasMore:false,items:[],context:'Choose a season to check the provider catalogue'};
 const variables:Record<string,unknown>={page,sort:body.sort==='rating'?'SCORE_DESC':body.sort==='new'||body.section==='new'?'START_DATE_DESC':'POPULARITY_DESC'};
 if(search)variables.search=search;
 const genre=String(body.genre||''),theme=String(body.theme||'');
 if(genre.startsWith('al:genre:'))variables.genre=genre.slice(9);
 else if(genre)throw new RangeError('These anime filters changed. Reset filters to browse the current provider.');
 if(theme.startsWith('al:tag:'))variables.tag=theme.slice(7);
 else if(theme)throw new RangeError('These anime filters changed. Reset filters to browse the current provider.');
 if(hasYear){variables.year=year;variables.season=body.season.toUpperCase();}
 if(body.section==='new'&&!hasYear){const d=new Date(Date.now()-90*86400000);variables.after=Number(d.toISOString().slice(0,10).replaceAll('-',''));const tomorrow=new Date(Date.now()+86400000);variables.before=Number(tomorrow.toISOString().slice(0,10).replaceAll('-',''));}
 const data=await query(`query($page:Int,$search:String,$genre:String,$tag:String,$year:Int,$season:MediaSeason,$sort:[MediaSort],$after:FuzzyDateInt,$before:FuzzyDateInt){Page(page:$page,perPage:24){pageInfo{hasNextPage} media(type:ANIME,isAdult:false,search:$search,genre:$genre,tag:$tag,seasonYear:$year,season:$season,sort:$sort,startDate_greater:$after,startDate_lesser:$before){${fields}}}}`,variables);
 return {configured:true,category:'anime',page,hasMore:!!data.Page?.pageInfo?.hasNextPage,items:(data.Page?.media||[]).filter((item:any)=>item.idMal&&!(item.genres||[]).includes('Hentai')).map(anilistItem),context:'AniList catalogue · provider genres, themes and season filters · MyAnimeList title identity'};
}
export async function animeDetail(id:number,query:Query=animeGraphql) {const data=await query(`query($id:Int){Media(idMal:$id,type:ANIME,isAdult:false){${fields}}}`,{id});return data.Media?{configured:true,...anilistItem(data.Media)}:{configured:true};}
