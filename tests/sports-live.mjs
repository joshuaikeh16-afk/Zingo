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
let user;const summary=[];
try {
 const suffix=randomBytes(8).toString('hex'),email=`kaidra-qa-sports-${suffix}@example.invalid`,password=randomBytes(24).toString('base64url');user=api('/auth/v1/admin/users','POST',{email,password,email_confirm:true});api('/rest/v1/profiles','POST',{id:user.id,username:'qa_'+suffix,display_name:'Sports QA',onboarding_completed:true});const token=api('/auth/v1/token?grant_type=password','POST',{email,password},anon).access_token;
 assert.equal(request('/functions/v1/sports-api','POST',{action:'team',id:42},anon).status,401);
 for(const body of [{action:'proxy',url:'https://example.com'},{action:'team',id:'bad'},{action:'search',query:'ab'},{action:'team',id:42,url:'https://example.com'}])assert.equal(request('/functions/v1/sports-api','POST',body,token).status,400);
 for(const query of ['Arsenal','Chelsea','Barcelona','Real Madrid']){const r=request('/functions/v1/sports-api','POST',{action:'search',query},token);summary.push({query,status:r.status,code:r.data?.code,teams:r.data?.response?.filter(x=>!x.team.national).slice(0,3).map(x=>({id:x.team.id,name:x.team.name}))});if(r.status<400)assert(r.data.response.length);}
 for(const [action,args] of [['team',{id:42}],['squad',{id:42}],['fixtures',{team:42,mode:'upcoming'}],['competitions',{id:42}],['player',{id:1460}],['fixtures',{mode:'today'}]]){const r=request('/functions/v1/sports-api','POST',{action,...args},token);summary.push({action,status:r.status,code:r.data?.code,results:r.data?.results});if(r.status<400&&action==='team')assert.equal(r.data.response[0].team.name,'Arsenal');}
 console.log(JSON.stringify(summary,null,2));
}finally{if(user)api('/auth/v1/admin/users/'+user.id,'DELETE');console.log('Temporary sports acceptance account removed.');}
