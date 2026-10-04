import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
// Opt-in: creates temporary users/chats in the linked project, then removes them.
if(process.env.KAIDRA_LIVE_QA!=='1')throw new Error('Set KAIDRA_LIVE_QA=1 to run live acceptance checks. Supabase CLI login required.');
const project='skmlktywdmsbjyybtmhm',base=`https://${project}.supabase.co`;
const keyRun=spawnSync('.tools/supabase/supabase',['projects','api-keys','--project-ref',project,'--reveal','--output','json'],{encoding:'utf8'});
if(keyRun.status!==0)throw new Error('Could not read test credentials');
const keys=JSON.parse(keyRun.stdout),service=keys.find(k=>k.name==='service_role').api_key,anon=keys.find(k=>k.name==='anon').api_key;
const bridge=`import json,sys,urllib.request,urllib.error
v=json.load(sys.stdin)
r=urllib.request.Request(v['url'],data=json.dumps(v['body']).encode() if v['body'] is not None else None,headers={'apikey':v['key'],'Authorization':'Bearer '+v['token'],'Content-Type':'application/json','Prefer':'return=representation'},method=v['method'])
try:
 with urllib.request.urlopen(r,timeout=45) as res:
  b=res.read();print(json.dumps({'status':res.status,'data':json.loads(b) if b else None}))
except urllib.error.HTTPError as e:
 print(json.dumps({'status':e.code,'data':json.loads(e.read())}))
`;
function request(path,method='GET',body=null,token=service){const r=spawnSync('python3',['-c',bridge],{input:JSON.stringify({url:base+path,method,body,token,key:anon}),encoding:'utf8',timeout:50000});if(r.status!==0)throw new Error('HTTP test transport failed');return JSON.parse(r.stdout);}
function api(path,method='GET',body=null,token=service){const r=request(path,method,body,token);assert(r.status<400,`HTTP ${r.status}: ${r.data?.code||r.data?.message||path}`);return r.data;}
const rpc=(name,args,token)=>api('/rest/v1/rpc/'+name,'POST',args,token);
let user;const failures=[];
try{
 const suffix=randomBytes(8).toString('hex'),email=`kaidra-qa-${suffix}@example.invalid`,password=randomBytes(24).toString('base64url');user=api('/auth/v1/admin/users','POST',{email,password,email_confirm:true});const token=api('/auth/v1/token?grant_type=password','POST',{email,password},anon).access_token;
 for(const category of ['movie','tv','anime']){try{const response=request('/functions/v1/content-api','POST',{action:'browse',category,page:1},token);assert(response.status<400,JSON.stringify({category,status:response.status,error:response.data?.error,code:response.data?.code}));assert(response.data.configured&&response.data.items.length);console.log('PASS deployed provider browse',category,response.data.items.length,'real titles');}catch(error){failures.push(category);console.error('Provider verification failed:',error.message);}}
 try{const archive=api('/functions/v1/content-api','POST',{action:'browse-meta',category:'anime'},token);assert(archive.genres.length&&archive.themes.length&&archive.years.some(row=>row.year<2000));console.log('PASS real anime provider genres, themes and historical seasons',archive.years.length,'years');const historical=archive.years.find(row=>row.year<2000&&row.seasons.length);const season=api('/functions/v1/content-api','POST',{action:'browse',category:'anime',year:historical.year,season:historical.seasons[0],page:1},token);assert(season.configured&&Array.isArray(season.items));console.log('PASS real historical anime season',historical.year,historical.seasons[0],season.items.length,'titles');}catch(error){failures.push('anime archive');console.error('Archive verification failed:',error.message);}
 const fixtures=api('/functions/v1/content-api','POST',{action:'fixtures'},token);assert(fixtures.configured&&fixtures.matches.length);const match=api('/functions/v1/content-api','POST',{action:'match',id:fixtures.matches[0].id},token).match;assert(match.homeId&&match.awayId);const state=rpc('kaidra_match_social',{target_match:match.id},token);if(state.locked){assert(request('/rest/v1/rpc/kaidra_match_support','POST',{target_match:match.id,side:'home'},token).status>=400);}else{rpc('kaidra_match_support',{target_match:match.id,side:'neutral'},token);assert.equal(rpc('kaidra_match_social',{target_match:match.id},token).own_support,'neutral');}console.log('PASS real football fixture normalization, provider snapshot ingestion and final lock/support');
 if(failures.length)throw new Error('Unavailable providers: '+failures.join(', '));
}finally{if(user)api('/auth/v1/admin/users/'+user.id,'DELETE');console.log('Temporary provider acceptance account removed.');}
