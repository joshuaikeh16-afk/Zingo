import http from 'node:http';
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
const root=resolve(import.meta.dirname,'..');
const server=http.createServer(async(req,res)=>{
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
async function wait(expression){const start=Date.now();while(Date.now()-start<10000){if(await evaluate(`(()=>{try{return Boolean(${expression})}catch{return false}})()`))return;await new Promise(r=>setTimeout(r,50));}throw new Error('Timed out: '+expression+'; '+errors.join(' | ')+'; '+await evaluate('document.body.innerText.slice(0,1800)')); }
const clickText=(selector,text)=>evaluate(`[...document.querySelectorAll(${JSON.stringify(selector)})].find(node=>node.textContent.trim()===${JSON.stringify(text)}).click()`);
const click=(selector)=>evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);

async function screenshot(name) { await new Promise(resolve=>setTimeout(resolve,350)); await evaluate('document.querySelector("#app-status")?.classList.add("hidden")'); await mkdir('/tmp/kaidra-qa',{recursive:true}); await writeFile('/tmp/kaidra-qa/'+name+'.png',Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64')); }
async function size(width,height=900) { await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<700}); }
async function route(tab) { await evaluate("document.dispatchEvent(new CustomEvent('kaidra:navigate',{detail:{tab:"+JSON.stringify(tab)+"}}))"); await new Promise(r=>setTimeout(r,80)); }
async function send(text) { await evaluate("document.querySelector('#message-text-input').value="+JSON.stringify(text)+";document.querySelector('#message-text-input').dispatchEvent(new Event('input'));document.querySelector('#message-form').requestSubmit()"); await wait('!document.querySelector(".is-sending")'); }
try {
 await call('Runtime.enable');await call('Page.enable');await call('Network.enable');await call('Network.setCacheDisabled',{cacheDisabled:true});await call('Page.navigate',{url:'about:blank'});await call('Storage.clearDataForOrigin',{origin:'http://127.0.0.1:8765',storageTypes:'all'});await size(390,844);await call('Page.navigate',{url:'http://127.0.0.1:8765/app.html#discover/sports/clubs'});
 await wait('document.querySelector(".sports-search input")');assert.equal(await evaluate('document.querySelector("[data-category=sports]").textContent.trim()'),'Sports');
 for(const name of ['Arsenal','Chelsea','Barcelona','Real Madrid']){await clickText('.sports-world .sports-tabs button',name);await wait('document.querySelector(".sports-directory strong")?.textContent==='+JSON.stringify(name));}
 await click('.sports-directory .sports-entity-card');await wait('document.querySelector(".sports-detail .sports-follow-actions")');assert(await evaluate('document.querySelector(".sports-identity-hero").textContent.includes("Real Madrid")'));
 await clickText('.sports-follow-actions button','Support Real Madrid');await wait('window.__mock.db.sports_follows.some(f=>f.is_primary)');assert.equal(await evaluate('window.__mock.db.sports_follows[0].is_public'),false);await screenshot('sports-club-mobile');
 await click('[data-close="content-detail-modal"]');await route('discover/sports/clubs');await clickText('.sports-world .sports-tabs button','Arsenal');await wait('document.querySelector(".sports-directory strong")?.textContent==="Arsenal"');await click('.sports-directory .sports-entity-card');await wait('document.querySelector(".sports-follow-actions")');await clickText('.sports-follow-actions button','Support Arsenal');await wait('document.querySelector(".confirm-modal")');await clickText('.confirm-modal button','Change club');await wait('window.__mock.db.sports_follows.some(f=>f.external_id==="42"&&f.is_primary)');
 await clickText('.sports-detail .sports-tabs button','Squad');await wait('document.querySelector(".sports-tab-body").textContent.includes("Bukayo Saka")');await click('.sports-tab-body .sports-entity-card');await wait('document.querySelector(".sports-detail").textContent.includes("Nationality: England")');await evaluate('const s=document.querySelector(".sports-season select");s.value="2026";s.dispatchEvent(new Event("change"))');await wait('document.querySelector(".sports-detail").textContent.includes("Appearances: 5")');await screenshot('sports-player-mobile');
 await route('sports/football/competition/39');await wait('document.querySelector(".sports-table")');assert.equal(await evaluate('document.querySelectorAll(".sports-table tbody tr").length'),2);
 await route('sports/football/event/100');await wait('document.querySelector(".sports-match-support")');assert.equal(await evaluate('document.querySelector("#content-detail-title").textContent'),'Match Center');await clickText('.sports-match-support button','Arsenal');await wait('window.__mock.db.sports_side_support[0]?.side==="home"');assert.equal(await evaluate('window.__mock.db.sports_side_support[0].is_public'),false);await clickText('.sports-detail .sports-tabs button','Lineups');await wait('document.querySelector(".sports-tab-body").textContent.includes("Official lineups have not been returned")');await screenshot('sports-match-mobile');
 await clickText('.sports-detail .detail-actions button','Start a Discussion');await wait('document.querySelector(".sports-discussion-dialog textarea")');await evaluate('document.querySelector(".sports-discussion-dialog textarea").value="Arsenal will win today";document.querySelector(".sports-discussion-dialog form").requestSubmit()');await wait('document.querySelector("#new-chat-list .person-row")');await click('#new-chat-list .person-row');await wait('window.__mock.db.messages.some(m=>m.message_type==="discussion"&&m.sports_context?.external_id==="100")');
 await route('inbox/'+await evaluate('window.__mock.a'));await wait('document.querySelector("#chat-view-drawer").classList.contains("is-active")');await send('.challenge');await wait('window.__mock.db.battles.length===1');assert.equal(await evaluate('window.__mock.db.battles[0].challenged_id'),await evaluate('window.__mock.alice'));
 await route('discover/sports/for-you');await wait('document.querySelector(".sports-supported")');assert(await evaluate('document.querySelector(".sports-supported").textContent.includes("Arsenal")'));await clickText('.sports-supported button','Notification preferences');await wait('document.querySelector(".sports-preferences-dialog form input")');assert.equal(await evaluate('[...document.querySelectorAll(".sports-preferences-dialog input")].some(i=>i.checked)'),false);await evaluate('document.querySelector(".sports-preferences-dialog form").requestSubmit()');await wait('!document.querySelector(".sports-preferences-dialog")');
 await size(1365,900);await screenshot('sports-for-you-desktop');assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false);await call('Page.reload');await wait('document.querySelector(".sports-supported").textContent.includes("Arsenal")');assert.equal(errors.length,0,errors.join('\n'));console.log('PASS mobile/desktop Sports searches, primary support/privacy/change confirmation, squads/player stats, standings, Match Center, contextual Discussion, preferences, refresh persistence and bare DM challenge.');
}finally{ws.close();server.close();if(browserProcess)browserProcess.kill();}
