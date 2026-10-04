import { createClient } from 'npm:@supabase/supabase-js@2';
import { cachedSports } from '../_shared/sports.ts';
// One shared job, no provider polling in fan browsers. No subscription means no call.
Deno.serve(async(request:Request)=>{
 const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
 if(request.method!=='POST')return json({code:'METHOD_NOT_ALLOWED'},405);
 const secret=Deno.env.get('SPORTS_SYNC_SECRET');if(!secret||request.headers.get('x-sync-secret')!==secret)return json({code:'AUTH_REQUIRED'},401);
 const service=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
 try{
  const {data:preferences,error}=await service.from('sports_notification_preferences').select('*').eq('enabled',true);if(error)throw error;
  if(!preferences?.some((p:any)=>p.reminders||p.results||p.lineups))return json({delivered:0,providerCallsNeeded:false});
  const {data:follows,error:followError}=await service.from('sports_follows').select('user_id,external_id').eq('sport','football').eq('provider','api-sports').eq('is_primary',true).in('user_id',preferences.map((p:any)=>p.user_id));if(followError)throw followError;
  if(!follows?.length)return json({delivered:0,providerCallsNeeded:false});
  const activeUsers=new Set(follows.map((f:any)=>f.user_id)),activePreferences=preferences.filter((p:any)=>activeUsers.has(p.user_id)),teams=new Set(follows.map((f:any)=>f.external_id));
  const data=await cachedSports(service,{action:'fixtures',sport:'football',mode:'today'},Deno.env.get('API_SPORTS_KEY')||'');
  if(data.stale)return json({delivered:0,warning:'STALE_PROVIDER_DATA'});
  let delivered=0,unavailable=0;
  for(const match of data.response.filter((m:any)=>teams.has(String(m.teams.home.id))||teams.has(String(m.teams.away.id)))){
   const id=String(match.fixture.id),start=Date.parse(match.fixture.date),delta=start-Date.now(),title=`${match.teams.home.name} vs ${match.teams.away.name}`;
   const send=async(category:string,heading:string,body:string)=>{const r=await service.rpc('kaidra_sports_deliver',{event_id:id,category_name:category,heading,body_text:body});if(r.error)throw r.error;delivered+=r.data||0;};
   if(delta>0&&delta<=3600000&&activePreferences.some((p:any)=>p.reminders))await send('reminders',`${title} · plays soon`,`${match.league.name} · Kickoff ${new Date(start).toISOString()}`);
   if(delta<0&&delta>-14400000&&['FT','AET','PEN'].includes(match.fixture.status.short)&&activePreferences.some((p:any)=>p.results))await send('results',`${title} · Full time`,`${match.goals.home}–${match.goals.away} · ${match.league.name}`);
   if(delta<=5400000&&delta>-900000&&['NS','TBD','1H'].includes(match.fixture.status.short)&&activePreferences.some((p:any)=>p.lineups)){
    try{const lineups=await cachedSports(service,{action:'lineups',sport:'football',id},Deno.env.get('API_SPORTS_KEY')||'');if(!lineups.stale&&lineups.response.length)await send('lineups',`${title} · Official lineups`, 'The provider’s official starting XI is now available in Match Center.');}catch{unavailable++;}
   }
  }
  return json({delivered,unavailable});
 }catch{return json({code:'SPORTS_SYNC_UNAVAILABLE'},503);}
});
