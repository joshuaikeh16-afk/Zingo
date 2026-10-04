// Provider contracts live here. Football is the only enabled adapter.
export class SportsError extends Error { code:string;status:number;constructor(code:string,status=400) {super(code);this.code=code;this.status=status;} }
const identifier=(v:unknown)=>{if(!/^[1-9]\d{0,9}$/.test(String(v??'')))throw new SportsError('INVALID_ID');return String(v);};
const season=(v:unknown)=>{const n=Number(v);if(!Number.isInteger(n)||n<2000||n>new Date().getUTCFullYear()+1)throw new SportsError('INVALID_SEASON');return String(n);};
const query=(v:unknown)=>{if(typeof v!=='string'||v.trim().length<3||v.trim().length>60||!/[\p{L}\p{N}]/u.test(v)||/[<>\x00-\x1f]/.test(v))throw new SportsError('INVALID_SEARCH');return v.trim();};
export function sportsOperation(body:Record<string,unknown>) {
 if(body.sport!==undefined&&body.sport!=='football')throw new SportsError('SPORT_NOT_AVAILABLE');
 if(body.provider!==undefined&&body.provider!=='api-sports')throw new SportsError('INVALID_PROVIDER');
 const params:Record<string,string>={};let path='',ttl=86400;
 const id=()=>identifier(body.id), yr=()=>season(body.season);
 switch(body.action){
 case 'search':path='/teams';params.search=query(body.query);ttl=604800;break;
 case 'team':path='/teams';params.id=id();break;
 case 'squad':path='/players/squads';params.team=id();break;
 case 'player':path='/players/profiles';params.player=id();break;
 case 'player-search':path='/players/profiles';params.search=query(body.query);params.page=String(body.page??1);if(!/^(?:[1-9]|[1-4][0-9]|50)$/.test(params.page))throw new SportsError('INVALID_PAGE');break;
 case 'player-stats':path='/players';params.id=id();params.season=yr();ttl=21600;break;
 case 'competitions':path='/leagues';if(body.id!==undefined)params.team=id();else params.current='true';break;
 case 'competition':path='/leagues';params.id=id();break;
 case 'teams':path='/teams';params.league=id();params.season=yr();break;
 case 'standings':path='/standings';params.league=id();params.season=yr();ttl=3600;break;
 case 'fixtures':path='/fixtures';ttl=900;
  if(body.team!==undefined)params.team=identifier(body.team);
  if(body.league!==undefined){params.league=identifier(body.league);params.season=yr();}
  if(body.mode==='today'){params.date=new Date().toISOString().slice(0,10);}
  else if(body.mode==='results'){if(!params.team&&!params.league)throw new SportsError('FIXTURE_CONTEXT_REQUIRED');params.last='10';ttl=3600;}
  else if(body.mode===undefined||body.mode==='upcoming'){if(!params.team&&!params.league)throw new SportsError('FIXTURE_CONTEXT_REQUIRED');params.next='10';}
  else throw new SportsError('INVALID_FIXTURE_MODE');break;
 case 'match':path='/fixtures';params.id=id();ttl=300;break;
 case 'events':case 'lineups':case 'statistics':path='/fixtures/'+body.action;params.fixture=id();ttl=600;break;
 case 'transfers':path='/transfers';params.player=id();ttl=86400;break;
 default:throw new SportsError('INVALID_ACTION');
 }
 const allowed=new Set(['action','sport','provider',...({search:['query'],'player-search':['query','page'],fixtures:['team','league','season','mode'],standings:['id','season'],teams:['id','season'],'player-stats':['id','season']}[String(body.action)]||['id'])]);
 if(Object.keys(body).some(k=>!allowed.has(k)))throw new SportsError('INVALID_PARAMETER');
 const entries=Object.entries(params).sort(([a],[b])=>a.localeCompare(b));
 // Stable IDs for official-lineup notification verification.
 const key=['events','lineups','statistics'].includes(String(body.action))?`football:${body.action}:${params.fixture}`:`football:${body.action}:${new URLSearchParams(entries)}`;
 return {path,params:Object.fromEntries(entries),ttl,key};
}
const image=(value:unknown)=>{if(typeof value!=='string')return null;try{const u=new URL(value);return u.protocol==='https:'&&['media.api-sports.io','media.api-football.com'].includes(u.hostname)?u.href:null;}catch{return null;}};
export function sportsEntities(data:any,action:string) {
 const entities:any[]=[];
 const add=(type:string,id:unknown,name:unknown,snapshot:any)=>{if(!/^[1-9]\d{0,9}$/.test(String(id))||typeof name!=='string'||!name)return;entities.push({sport:'football',provider:'api-sports',entity_type:type,external_id:String(id),display_name:name.slice(0,300),snapshot:{...snapshot,image:image(snapshot.image),...(type==='player'&&action==='squad'?{squad_verified_at:new Date().toISOString()}: {})},verified_at:new Date().toISOString()});};
 for(const row of data.response||[]){
  if(['search','team','teams'].includes(action))add('team',row.team?.id,row.team?.name,{...row,image:row.team?.logo});
  if(['competition','competitions'].includes(action))add('competition',row.league?.id,row.league?.name,{...row,image:row.league?.logo});
  if(['player','player-stats','player-search'].includes(action))add('player',row.player?.id,row.player?.name,{...row,image:row.player?.photo});
  if(action==='squad')for(const p of row.players||[])add('player',p.id,p.name,{player:p,team:row.team,image:p.photo});
  if(['match','fixtures'].includes(action)) {add('event',row.fixture?.id,`${row.teams?.home?.name||'Home'} vs ${row.teams?.away?.name||'Away'}`,row);}
 }
 return [...new Map(entities.map(e=>[e.entity_type+':'+e.external_id,e])).values()];
}
export async function cachedSports(service:any,body:Record<string,unknown>,apiKey:string,actor:string|null=null):Promise<any> {
 const operation=sportsOperation(body),rpc=async(name:string,args:any)=>{const r=await service.rpc(name,args);if(r.error)throw new SportsError('SPORTS_STORAGE_UNAVAILABLE',503);return r.data;};
 let claim=await rpc('kaidra_sports_cache_claim',{key:operation.key,actor});
 if(claim.state==='busy'&&!claim.data){await new Promise(resolve=>setTimeout(resolve,1000));claim=await rpc('kaidra_sports_cache_claim',{key:operation.key,actor:null});}
 const result=(data:any,stale:boolean,at:string,expires?:string)=>({...data,sport:'football',provider:'api-sports',cached:true,stale,fetched_at:at,expires_at:expires});
 const limitedFixtures=async()=>{const today=await cachedSports(service,{action:'fixtures',sport:'football',mode:'today'},apiKey,null);const team=String(body.team||''),league=String(body.league||'');const ended=['FT','AET','PEN'];return {...today,response:today.response.filter((m:any)=>(!team||[String(m.teams.home.id),String(m.teams.away.id)].includes(team))&&(!league||String(m.league.id)===league)&&(body.mode==='results'?ended.includes(m.fixture.status.short):!ended.includes(m.fixture.status.short))),limited_scope:'today',warning:'PROVIDER_PLAN_LIMIT'};};
 if(claim.state==='error'&&claim.code==='PROVIDER_PLAN_LIMIT'&&body.action==='fixtures'&&body.mode!=='today')return limitedFixtures();
 if(claim.state==='hit')return result(claim.data,false,claim.fetched_at,claim.expires_at);
 if(claim.state!=='fetch'){if(claim.data)return {...result(claim.data,true,claim.fetched_at),warning:claim.state==='quota'?'QUOTA_LIMIT':claim.code||'CACHED_SNAPSHOT'};throw new SportsError(claim.state==='limited'?'RATE_LIMIT':claim.state==='quota'?'QUOTA_LIMIT':claim.code||'SPORTS_REFRESH_PENDING',claim.state==='limited'||claim.state==='quota'?429:503);}
 if(!apiKey){await rpc('kaidra_sports_cache_store',{key:operation.key,payload:null,ttl:300,code:'PROVIDER_NOT_CONFIGURED'});throw new SportsError('PROVIDER_NOT_CONFIGURED',503);}
 let remaining:number|null=null;
 try{
  const response=await fetch('https://v3.football.api-sports.io'+operation.path+'?'+new URLSearchParams(operation.params),{headers:{'x-apisports-key':apiKey},signal:AbortSignal.timeout(12000),redirect:'error'});
  const header=response.headers.get('x-ratelimit-requests-remaining');if(header!==null&&/^\d+$/.test(header))remaining=Number(header);
  if(!response.ok)throw new SportsError(response.status===429?'PROVIDER_QUOTA_LIMIT':'PROVIDER_UNAVAILABLE',503);
  const raw=await response.json();
  if(raw.errors&&Object.keys(raw.errors).length){const msg=Object.values(raw.errors).join(' ').toLowerCase();throw new SportsError(/plan|season|subscription/.test(msg)?'PROVIDER_PLAN_LIMIT':/limit|quota/.test(msg)?'PROVIDER_QUOTA_LIMIT':'PROVIDER_UNAVAILABLE',503);}
  if(!Array.isArray(raw.response))throw new SportsError('INVALID_PROVIDER_RESPONSE',502);
  // Never return echoed request headers, diagnostic/provider error text or credentials.
  const data={response:raw.response,paging:raw.paging||{current:1,total:1},results:raw.results??raw.response.length};
  const entities=sportsEntities(data,String(body.action));if(entities.length){const stored=await service.rpc('kaidra_sports_ingest',{items:entities});if(stored.error)throw new SportsError('SPORTS_STORAGE_UNAVAILABLE',503);}
  const ttl=body.action==='match'&&['FT','AET','PEN','CANC','ABD','AWD','WO'].includes(data.response[0]?.fixture?.status?.short)?86400:operation.ttl;
  await rpc('kaidra_sports_cache_store',{key:operation.key,payload:data,ttl,remaining});
  const at=new Date().toISOString();return {...result(data,false,at,new Date(Date.now()+ttl*1000).toISOString()),cached:false};
 }catch(error){const code=error instanceof SportsError?error.code:'PROVIDER_TIMEOUT';await rpc('kaidra_sports_cache_store',{key:operation.key,payload:null,ttl:300,code,remaining});if(code==='PROVIDER_PLAN_LIMIT'&&body.action==='fixtures'&&body.mode!=='today')return limitedFixtures();if(claim.data)return {...result(claim.data,true,claim.fetched_at),warning:code};throw new SportsError(code,503);}
}
