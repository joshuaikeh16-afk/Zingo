import http from 'node:http';
import {stripTypeScriptTypes} from 'node:module';
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
const root=resolve(import.meta.dirname,'..');
const server=http.createServer(async(req,res)=>{
  if(new URL(req.url,'http://localhost').pathname==='/tests/combat-engine.js'){res.setHeader('Content-Type','application/javascript');return res.end(stripTypeScriptTypes(await readFile(root+'/supabase/functions/_shared/combat.ts','utf8')));}
  const path=resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
  if(!path.startsWith(root+'/')){res.writeHead(403);return res.end();}
  try{
    let body=await readFile(path);
    if(path.endsWith('/js/supabase-client.js'))body=Buffer.from(body.toString().replace('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm','/tests/mock-supabase.js'));
    res.setHeader('Content-Type',({'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json'})[extname(path)]||'text/plain');res.end(body);
  }catch{res.writeHead(404);res.end('Not found');}
});
await new Promise((done,reject)=>{server.once('error',reject);server.listen(8765,'127.0.0.1',done);});
let browserProcess;
const browserDir = await mkdtemp('/tmp/kaidra-test-browser-');
try { await fetch('http://127.0.0.1:9222/json'); }
catch {
  browserProcess = spawn('google-chrome',['--headless','--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--remote-debugging-port=9222',`--user-data-dir=${browserDir}`,'about:blank'],{stdio:'ignore'});
  const start=Date.now(); while(true) { try { await fetch('http://127.0.0.1:9222/json'); break; } catch { if(Date.now()-start>10000) throw new Error('Chrome did not start'); await new Promise(resolve=>setTimeout(resolve,100)); } }
}
const tabs=await(await fetch('http://127.0.0.1:9222/json')).json();
const tab=tabs.find(tab=>tab.type==='page');
const ws=new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((done,reject)=>{ws.onopen=done;ws.onerror=reject;});
let seq=0;const pending=new Map(),errors=[];
ws.onmessage=({data})=>{const value=JSON.parse(data);if(value.id){const item=pending.get(value.id);pending.delete(value.id);if(value.error)item.reject(value.error);else item.resolve(value.result);}else if(value.method==='Runtime.exceptionThrown')errors.push(value.params.exceptionDetails.exception?.description||value.params.exceptionDetails.text);};
function call(method,params={}){return new Promise((resolve,reject)=>{const id=++seq;const timer=setTimeout(()=>{pending.delete(id);reject(new Error('Browser command timed out: '+method));},20000);pending.set(id,{resolve:value=>{clearTimeout(timer);resolve(value)},reject:error=>{clearTimeout(timer);reject(error)}});ws.send(JSON.stringify({id,method,params}));});}
async function evaluate(expression){const result=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);return result.result.value;}
async function perform(expression){return evaluate(`(async()=>{${expression}})()`);}
async function wait(expression){const start=Date.now();while(Date.now()-start<10000){if(await evaluate(`(()=>{try{return Boolean(${expression})}catch{return false}})()`))return;await new Promise(r=>setTimeout(r,50));}throw new Error('Timed out: '+expression);}
const clickText=(selector,text)=>evaluate(`[...document.querySelectorAll(${JSON.stringify(selector)})].find(node=>node.textContent.trim()===${JSON.stringify(text)}).click()`);
const click=(selector)=>evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);

async function screenshot(name) { await new Promise(resolve=>setTimeout(resolve,350)); await evaluate('document.querySelector("#app-status")?.classList.add("hidden")'); await mkdir('/tmp/kaidra-qa',{recursive:true}); await writeFile('/tmp/kaidra-qa/'+name+'.png',Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64')); }
async function size(width,height=900) { await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<700}); }
async function route(tab) { await evaluate("document.dispatchEvent(new CustomEvent('kaidra:navigate',{detail:{tab:"+JSON.stringify(tab)+"}}))"); await new Promise(r=>setTimeout(r,80)); }
async function send(text) { await evaluate("document.querySelector('#message-text-input').value="+JSON.stringify(text)+";document.querySelector('#message-text-input').dispatchEvent(new Event('input'));document.querySelector('#message-form').requestSubmit()"); await wait('!document.querySelector(".is-sending")'); }

try {
 await call('Runtime.enable');await call('Page.enable');await call('Network.enable');await call('Network.setCacheDisabled',{cacheDisabled:true});await call('Network.setBlockedURLs',{urls:['*fonts.googleapis.com*','*fonts.gstatic.com*']});await call('Storage.clearDataForOrigin',{origin:'http://127.0.0.1:8765',storageTypes:'all'});await size(390,844);await call('Page.navigate',{url:'http://127.0.0.1:8765/app.html#home'});await wait('window.__mock && document.querySelector("#profile-display-name").textContent==="Josh"');await perform('const {install}=await import("/tests/mock-combat.js");install(window.__mock)');
 const attacks={warrior:'Slash',wizard:'Arcane Bolt',ninja:'Shadow Strike',guardian:'Shield Bash',rogue:'Cheap Shot',healer:'Radiant Strike',ranger:'Quick Shot',berserker:'Blood Strike'};
 for(const [cls,name]of Object.entries(attacks)){
  const id=await perform(`return window.__mock.setupCombat([${JSON.stringify(cls)},'warrior'])`);await route('battle/'+id);await wait('document.querySelector(".combat-actions")');
  assert(await evaluate('document.documentElement.scrollWidth<=innerWidth'));assert.equal(await evaluate('[...document.querySelectorAll(".combat-fighter")].find(f=>f.dataset.fighterId===window.__mock.me).dataset.class'),cls);
  const buttons=await evaluate('[...document.querySelectorAll(".combat-ability-button strong")].map(b=>b.textContent)');assert(buttons.includes(name));await evaluate(`[...document.querySelectorAll('.combat-ability-button')].find(b=>b.querySelector('strong').textContent===${JSON.stringify(name)}).click()`);await wait('document.querySelector(".is-selected")');await evaluate('document.querySelector(".combat-actions .primary-button").focus()');assert(await evaluate('document.activeElement.classList.contains("primary-button")'));await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',text:'\r',windowsVirtualKeyCode:13});await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await wait('window.__mock.combat.revision===2');await wait('!document.querySelector(".combat-actions")');assert(await evaluate('window.__mock.combat.fighters[1].hp<120'));
  if(cls==='ninja')await screenshot('combat-ninja-mobile');await route('home');await wait('!document.querySelector(".combat-arena-modal")');
 }
 console.log('PASS all eight class identities, actual action controls, keyboard confirmation, authoritative HP display and mobile fit.');
 const id=await perform('return window.__mock.setupCombat(["healer","guardian","ninja","ranger"])');await perform('window.__mock.combat.fighters[1].hp=65');await route('battle/'+id);await wait('document.querySelectorAll(".combat-fighter").length===4');await evaluate('[...document.querySelectorAll(".combat-ability-button")].find(b=>b.querySelector("strong").textContent==="Restoration").click()');await wait('document.querySelectorAll(".is-eligible").length===2');await evaluate('[...document.querySelectorAll(".combat-character")].find(b=>b.getAttribute("aria-label").startsWith("Select Alice")).click()');await click('.combat-actions .primary-button');await wait('window.__mock.combat.fighters[1].hp===91');await wait('document.querySelector(".combat-log")');await screenshot('combat-team-mobile');await size(844,390);assert(await evaluate('document.documentElement.scrollWidth<=innerWidth'));await screenshot('combat-landscape');await size(1366,900);await screenshot('combat-team-desktop');assert(await evaluate('document.documentElement.scrollWidth<=innerWidth'));
 await route('home');await size(390,844);const duel=await perform('return window.__mock.setupCombat(["warrior","warrior"])');await route('battle/'+duel);await wait('document.querySelector(".combat-actions")');await perform('window.__mock.combat.fighters[1].hp=1;window.__mock.combatAct({ability_id:"slash",target_id:window.__mock.alice})');await wait('document.querySelector(".combat-result h2")?.textContent==="VICTORY"');assert(await evaluate('document.querySelector(".combat-xp").textContent.includes("25 XP")'));await screenshot('combat-victory-mobile');await clickText('.combat-result button','Return to conversation');await wait('location.hash.startsWith("#inbox/")');
 await perform('await window.__mock.setupCombat(["warrior","warrior"])');await route('inbox/'+await evaluate('window.__mock.a'));await wait('document.querySelector("#message-text-input")');await send('.forfeit');await wait('document.querySelector(".confirm-modal:not(.hidden)")');await clickText('.confirm-modal:not(.hidden) button','Forfeit');await wait('window.__mock.combat.phase==="finished"');assert.equal(await evaluate('window.__mock.combat.winning_team'),2);assert.equal(await evaluate('window.__mock.db.messages.filter(m=>m.content===".forfeit").length'),0);console.log('PASS .forfeit command confirmation, own fighter surrender and no command message leakage.');
 await route('arena');await wait('document.querySelector(".battle-hub")');await clickText('.battle-hub button','Create party');await wait('document.querySelector(".party-create-form")');await evaluate('document.querySelector(".party-create-form input").value="Nightfall";document.querySelector(".party-create-form").requestSubmit()');await wait('location.hash.startsWith("#party/")&&document.querySelector(".party-roster")');assert(await evaluate('document.querySelector(".battle-hub h2").textContent==="Nightfall"'));await clickText('.battle-hub button','Invite a friend');await wait('document.querySelector(".party-invite-modal")');await evaluate('document.querySelector(".party-invite-modal .quiet-button").click()');await wait('window.__mock.db.rpg_party_invites.length===1');await screenshot('party-mobile');
 await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});assert(await evaluate('matchMedia("(prefers-reduced-motion: reduce)").matches'));assert.deepEqual(errors,[]);console.log('PASS 2v2 ally targeting/healing, realtime action updates, landscape/desktop fit, HP victory/private XP, return to chat, party create/invite and reduced-motion media.');
}catch(error){console.error(error);console.error('Runtime errors:',errors);console.error(await evaluate('({last:window.__mock.calls.slice(-3),state:window.__mock.combat?.revision,error:document.querySelector(".combat-error")?.textContent})'));await screenshot('combat-failure');process.exitCode=1;}
finally{ws.close();server.close();browserProcess?.kill();}
