import { supabase } from './supabase-client.js';
export const sportsRegistry = Object.freeze({football:{name:'Football',provider:'api-sports',enabled:true,entityTypes:['team','player','competition','event']},basketball:{name:'Basketball',enabled:false},f1:{name:'Formula 1',enabled:false}});
const memory = new Map(), pending = new Map();
const messages={PROVIDER_PLAN_LIMIT:'Your sports provider plan does not cover this data. Other sections may still be available.',QUOTA_LIMIT:'Sports updates have reached today’s shared limit. Please try again tomorrow.',PROVIDER_QUOTA_LIMIT:'The sports provider has reached its request limit.',RATE_LIMIT:'Take a moment before searching again.',AUTH_REQUIRED:'Sign in again to view Sports.',PROVIDER_NOT_CONFIGURED:'The sports provider is not configured.',SPORTS_REFRESH_PENDING:'Sports data is refreshing. Try again shortly.'};
export const sportsRef=(type,id)=>({sport:'football',provider:'api-sports',entity_type:type,external_id:String(id)});
export const sportsPath=ref=>`sports/${ref.sport}/${ref.entity_type}/${ref.external_id}`;
export async function sportsRequest(action,args={}) {
 const body={action,sport:'football',...args},key=JSON.stringify(body),hit=memory.get(key);
 if(hit?.until>Date.now())return structuredClone(hit.data);
 if(!navigator.onLine&&hit)return {...structuredClone(hit.data),stale:true,offline:true};
 if(pending.has(key))return structuredClone(await pending.get(key));
 const task=(async()=>{const {data,error}=await supabase.functions.invoke('sports-api',{body});let problem=data;
  if(error?.context?.json)try{problem=await error.context.clone().json();}catch{}
  if(error||data?.code){if(hit)return {...structuredClone(hit.data),stale:true,warning:problem?.code};throw new Error(messages[problem?.code]||'Sports data is unavailable right now. Please try another section.');}
  if(memory.size>=80)memory.delete(memory.keys().next().value);memory.set(key,{data,until:Math.min(Date.parse(data.expires_at)||Date.now()+60000,Date.now()+300000)});return data;
 })();pending.set(key,task);try{return structuredClone(await task);}finally{pending.delete(key);}
}
export async function sportsRpc(name,args={}){const {data,error}=await supabase.rpc(name,args);if(error)throw error;return data;}
export async function sportsFollows(){const {data,error}=await supabase.from('sports_follows').select('*,sports_entities(*)');if(error)throw error;return data||[];}
