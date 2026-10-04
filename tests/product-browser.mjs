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
async function perform(expression){return evaluate(`(async()=>{${expression}})()`);}
async function wait(expression){const start=Date.now();while(Date.now()-start<10000){if(await evaluate(`(()=>{try{return Boolean(${expression})}catch{return false}})()`))return;await new Promise(r=>setTimeout(r,50));}throw new Error('Timed out: '+expression);}
const clickText=(selector,text)=>evaluate(`[...document.querySelectorAll(${JSON.stringify(selector)})].find(node=>node.textContent.trim()===${JSON.stringify(text)}).click()`);
const click=(selector)=>evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);

async function screenshot(name) { await new Promise(resolve=>setTimeout(resolve,350)); await evaluate('document.querySelector("#app-status")?.classList.add("hidden")'); await mkdir('/tmp/kaidra-qa',{recursive:true}); await writeFile('/tmp/kaidra-qa/'+name+'.png',Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64')); }
async function size(width,height=900) { await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<700}); }
async function route(tab) { await evaluate("document.dispatchEvent(new CustomEvent('kaidra:navigate',{detail:{tab:"+JSON.stringify(tab)+"}}))"); await new Promise(r=>setTimeout(r,80)); }
async function send(text) { await evaluate("document.querySelector('#message-text-input').value="+JSON.stringify(text)+";document.querySelector('#message-text-input').dispatchEvent(new Event('input'));document.querySelector('#message-form').requestSubmit()"); await wait('!document.querySelector(".is-sending")'); }
try {
 await call('Runtime.enable');await call('Page.enable');await call('Network.enable');await call('Network.setCacheDisabled',{cacheDisabled:true});await call('Network.setBlockedURLs',{urls:['*fonts.googleapis.com*','*fonts.gstatic.com*']});
 await call('Storage.clearDataForOrigin',{origin:'http://127.0.0.1:8765',storageTypes:'all'});await size(390,844);
 await call('Page.navigate',{url:'http://127.0.0.1:8765/app.html#home'});await wait('window.__mock && document.querySelector("#profile-display-name").textContent==="Josh"');
 await route('friends');await click('#find-friends-btn');await wait('document.activeElement.id==="find-friends-input"');
 await evaluate('Object.defineProperty(visualViewport,"height",{value:400,configurable:true});Object.defineProperty(visualViewport,"offsetTop",{value:30,configurable:true});visualViewport.dispatchEvent(new Event("resize"))');
 await new Promise(done=>setTimeout(done,350));
 const keyboard=await evaluate('(()=>{const sheet=document.querySelector("#find-friends-modal .social-modal-card").getBoundingClientRect(),input=document.querySelector("#find-friends-input").getBoundingClientRect();return {top:sheet.top,bottom:sheet.bottom,inputBottom:input.bottom,font:getComputedStyle(document.querySelector("#find-friends-input")).fontSize,backdrop:getComputedStyle(document.querySelector("#find-friends-modal")).backgroundColor,results:getComputedStyle(document.querySelector("#find-friends-results")).overflowY}})()');
 assert(keyboard.top>=30&&keyboard.bottom<=430&&keyboard.inputBottom<430,JSON.stringify(keyboard));assert.equal(keyboard.font,'16px');assert.equal(keyboard.results,'auto');assert.notEqual(keyboard.backdrop,'rgba(0, 0, 0, 0)');
 await screenshot('product-find-people-keyboard');await click('#find-friends-close-btn');await evaluate('delete visualViewport.height;delete visualViewport.offsetTop;visualViewport.dispatchEvent(new Event("resize"))');
 await route('discover');await wait('document.querySelectorAll(".hub-card").length===4');assert.equal(await evaluate('!!document.querySelector("#content-categories [data-category=for-you]")'),false);
 await click('[data-hub="anime"]');await wait('document.querySelector("[data-filter=theme]") && document.querySelector("#discover-grid .content-card")');
 await clickText('#discover-sections button','Seasons');await wait('document.querySelectorAll(".archive-card").length>=3');await wait('[...document.querySelectorAll("[data-filter=year] option")].some(option=>option.value==="2030")');
 await evaluate('document.querySelector("[data-filter=year]").value="1980";document.querySelector("[data-filter=year]").dispatchEvent(new Event("change"))');await wait('document.querySelector("[data-filter=season] option[value=fall]")');
 await evaluate('document.querySelector("[data-filter=season]").value="fall";document.querySelector("[data-filter=season]").dispatchEvent(new Event("change"))');await wait('document.querySelector("#discover-hero h2").textContent.includes("Fall 1980")');
 await evaluate('document.querySelector("[data-filter=theme]").value="40";document.querySelector("[data-filter=theme]").dispatchEvent(new Event("change"))');await wait('document.querySelector("#discover-hero h2").textContent.includes("Psychological")');await screenshot('product-anime-archive-mobile');
 await click('[data-category="movie"]');await wait('document.querySelector("[data-filter=cinema]")');await evaluate('document.querySelector("[data-filter=cinema]").value="NG";document.querySelector("[data-filter=cinema]").dispatchEvent(new Event("change"))');await wait('document.querySelector("#discover-hero h2").textContent.includes("Nollywood")');
 await evaluate('history.back()');await wait('!location.hash.includes("cinema=NG")');
 await perform('window.__mock.liveMatch=true;const client=await import("/js/content-client.js");client.clearContentCache()');await click('[data-category="football"]');await wait('document.querySelector("#discover-grid .match-open")');await click('#discover-grid .match-open');await wait('document.querySelector(".support-buttons button:not(:disabled)")');await clickText('.support-buttons button','Neutral');await wait('window.__mock.ownSupport==="neutral"');assert.equal(await evaluate('document.querySelector(".support-buttons button:nth-child(2)").getAttribute("aria-pressed")'),'true');
 await clickText('.match-social-panel button','Follow clubs & competitions');await wait('document.querySelector(".follow-clubs input")');await click('.follow-clubs input');await clickText('.social-modal button','Save football interests');await wait('window.__mock.db.profiles[0].recommendation_preferences.football_clubs.includes(10)');
 await clickText('#content-detail-body button','Challenge a friend');await wait('document.querySelector(".challenge-dialog form")');await evaluate('document.querySelector(".challenge-dialog input").value="The home side has the better defence";document.querySelector(".challenge-dialog form").requestSubmit()');await wait('location.hash.startsWith("#battle/") && document.querySelector(".battle-body")');
 assert.equal(await evaluate('document.querySelector("#content-detail-modal").classList.contains("hidden")'),true);await screenshot('product-battle-mobile');await clickText('.battle-body button','Cancel challenge');await wait('document.querySelector(".battle-body .eyebrow").textContent.includes("CANCELLED")');await click('.battle-modal .modal-heading button');await wait('!document.querySelector(".battle-modal")');
 await route('user/'+await evaluate('window.__mock.alice'));await wait('!document.querySelector("#profile-relationship-btn").classList.contains("hidden")');await click('#profile-relationship-btn');await wait('document.querySelector(".relationship-dialog form")');assert.equal(await evaluate('document.querySelectorAll(".relationship-dialog select")[1].value'),'private');assert.equal(await evaluate('document.querySelector(".relationship-dialog input[type=checkbox]").checked'),false);await evaluate('document.querySelector(".relationship-dialog form").requestSubmit()');await wait('window.__mock.db.relationships.length===1');
 await route('profile');await click('#open-settings-btn');await wait('!document.querySelector("#save-social-settings").disabled');await evaluate('document.querySelector("#activity-visibility").value="friends";document.querySelector("[data-notify-category=battle]").checked=false');await click('#save-social-settings');await wait('window.__mock.db.social_preferences[0]?.notifications.battle===false');await click('#close-settings-btn');
 await route('inbox');await click('.conversation-row');await wait('document.querySelector(".message-actions button")');await perform('const reactions=await import("/js/context-menu.js");reactions.openReactions(document.querySelector(".message-actions button"),["❤️","😂","🔥","😮","👏","⚽"],"🔥",async()=>{})');await wait('document.querySelector(".reaction-choice[aria-pressed=true]")');assert.equal(await evaluate('document.querySelector(".reaction-choice[aria-pressed=true]").textContent'),'🔥');const popover=await evaluate('(()=>{const r=document.querySelector(".reaction-popover .social-modal-card").getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom}})()');assert(popover.left>=0&&popover.right<=390&&popover.top>=0&&popover.bottom<=844);await screenshot('product-reactions-mobile');await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await wait('!document.querySelector(".reaction-popover")');
 await route('home');await perform('const content=await import("/js/content-view.js");content.openContent({provider:"mal",kind:"movie",id:77,title:"Legacy MAL film",image:"/tests/artwork.svg"})');await wait('document.querySelector("#content-detail-body h2")');await clickText('#content-detail-body button','Saved options');await wait('document.querySelector(".context-menu")');await clickText('.context-menu button','Add to Favorites');await wait('window.__mock.db.user_watchlist.some(row=>row.provider==="mal"&&row.media_type==="movie"&&row.external_id==="77")');assert.equal(await evaluate('window.__mock.db.user_watchlist.some(row=>row.provider==="mal"&&row.media_type==="anime"&&row.external_id==="77")'),false);await click('[data-close="content-detail-modal"]');
 await route('discover/anime/seasons?season=fall&year=1980');await size(1366,900);await wait('document.querySelector("[data-filter=year]")');await screenshot('product-discover-desktop');assert(await evaluate('document.documentElement.scrollWidth<=innerWidth'));
 assert.deepEqual(errors,[]);console.log('PASS product browser checks: keyboard viewport/backdrop, compact reactions, independent Discover, historical/future anime filters, origin banners, support, club preferences, challenge/cancel, relationship privacy defaults, notification settings and responsive layouts.');
} catch(error){console.error(error);console.error('Runtime errors:',errors);process.exitCode=1;}
finally{ws.close();server.close();browserProcess?.kill();}
