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
function request(path,method='GET',body=null,token=service){const retry=method==='GET'||method==='DELETE'||path.startsWith('/functions/')||path.startsWith('/auth/v1/token');for(let attempt=0;attempt<(retry?3:1);attempt++){const r=spawnSync('python3',['-c',bridge],{input:JSON.stringify({url:base+path,method,body,token,key:anon}),encoding:'utf8',timeout:50000});if(r.status===0)return JSON.parse(r.stdout);}throw new Error('HTTP test transport failed after retries');}
function api(path,method='GET',body=null,token=service){const r=request(path,method,body,token);assert(r.status<400,`HTTP ${r.status}: ${r.data?.code||r.data?.message||path}`);return r.data;}
const rpc=(name,args,token)=>api('/rest/v1/rpc/'+name,'POST',args,token);
let user;
try {
 const suffix=randomBytes(8).toString('hex'),email=`kaidra-qa-${suffix}@example.invalid`,password=randomBytes(24).toString('base64url');user=api('/auth/v1/admin/users','POST',{email,password,email_confirm:true});const token=api('/auth/v1/token?grant_type=password','POST',{email,password},anon).access_token;
 const feed=body=>api('/functions/v1/content-api','POST',body,token);
 const meta=feed({action:'browse-meta',category:'anime'});assert(meta.genres.length&&meta.themes.length&&meta.years.some(y=>y.year<2000));console.log('PASS deployed anime metadata',meta.source,meta.genres.length,'genres',meta.themes.length,'themes',meta.years.length,'calendar years');
 const cases=[['popular',{}],['genre',{genre:meta.genres.find(g=>g.name==='Romance').id}],['theme',{theme:meta.themes.find(t=>t.name==='Isekai').id}],['historical season',{year:2010,season:'fall'}],['current season',{year:2026,season:'fall'}],['new',{section:'new'}]];
 for(const [label,filters] of cases){const data=feed({action:'browse',category:'anime',page:1,...filters});assert(data.configured&&Array.isArray(data.items));assert(data.items.length,label+' returned no titles');assert(data.items.every(i=>i.provider==='mal'&&i.id));console.log('PASS deployed anime',label,data.items.length,'real titles',data.items.filter(i=>i.backdrop).length,'wide banners');if(label==='popular'){const detail=feed({action:'anime-detail',id:data.items[0].id});assert(detail.id===data.items[0].id);console.log('PASS detail lookup preserves MAL title identity');}}
 const series=feed({action:'browse',category:'tv',page:1});assert(series.items.some(i=>i.backdrop?.startsWith('https://image.tmdb.org/')));console.log('PASS Series still uses genuine TMDB backdrop');
}finally{if(user)api('/auth/v1/admin/users/'+user.id,'DELETE');console.log('Temporary anime acceptance account removed.');}
