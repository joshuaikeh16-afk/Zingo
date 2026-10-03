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
async function wait(expression){const start=Date.now();while(Date.now()-start<10000){if(await evaluate(`(()=>{try{return Boolean(${expression})}catch{return false}})()`))return;await new Promise(r=>setTimeout(r,50));}throw new Error('Timed out: '+expression);}
const clickText=(selector,text)=>evaluate(`[...document.querySelectorAll(${JSON.stringify(selector)})].find(node=>node.textContent.trim()===${JSON.stringify(text)}).click()`);
const click=(selector)=>evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);

async function screenshot(name) { await new Promise(resolve=>setTimeout(resolve,350)); await evaluate('document.querySelector("#app-status")?.classList.add("hidden")'); await mkdir('/tmp/kaidra-qa',{recursive:true}); await writeFile('/tmp/kaidra-qa/'+name+'.png',Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64')); }
async function size(width,height=900) { await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<700}); }
async function route(tab) { await evaluate("document.dispatchEvent(new CustomEvent('kaidra:navigate',{detail:{tab:"+JSON.stringify(tab)+"}}))"); await new Promise(r=>setTimeout(r,80)); }
async function send(text) { await evaluate("document.querySelector('#message-text-input').value="+JSON.stringify(text)+";document.querySelector('#message-text-input').dispatchEvent(new Event('input'));document.querySelector('#message-form').requestSubmit()"); await wait('!document.querySelector(".is-sending")'); }
try {
 await call('Runtime.enable');await call('Page.enable');await call('Network.enable');await call('Network.setCacheDisabled',{cacheDisabled:true});await call('Network.setBlockedURLs',{urls:['*fonts.googleapis.com*','*fonts.gstatic.com*']});
 await call('Page.navigate',{url:'http://127.0.0.1:8765/app.html#home'});await wait('window.__mock && document.querySelector("#profile-display-name").textContent==="Josh"');
 await evaluate('sessionStorage.clear();localStorage.clear();sessionStorage.setItem("qa:signed-out","true")');
 await call('Page.navigate',{url:'http://127.0.0.1:8765/signup.html'});await wait('document.querySelector("#auth-form")&&window.__mock');
 await evaluate('document.querySelector("#email-input").value="bad-address";document.querySelector("#password-input").value="short";document.querySelector("#auth-form").requestSubmit()');
 assert.equal(await evaluate('window.__mock.signupCalls||0'),0);assert(await evaluate('document.querySelector("#email-error").textContent.length>0'));
 await evaluate('document.querySelector("#email-input").value="long.but.valid.email.for.mobile@example.com";document.querySelector("#auth-form").requestSubmit()');assert.equal(await evaluate('window.__mock.signupCalls||0'),0);
 await evaluate('document.querySelector("#password-input").value="a long unique passphrase";document.querySelector("#password-input").dispatchEvent(new Event("input"));document.querySelector("#auth-form").requestSubmit();document.querySelector("#auth-form").requestSubmit()');
 await wait('!document.querySelector("#verification-panel").classList.contains("hidden")');assert.equal(await evaluate('window.__mock.signupCalls'),1);assert(await evaluate('document.querySelector("#resend-verification").disabled'));
 for(const width of [320,360,375,390,412,430,768,1280,1600]){await size(width,780);assert(await evaluate('document.documentElement.scrollWidth<=innerWidth'),'Verification overflows '+width);await screenshot(width+'-verification');}
 await call('Page.reload');await wait('!document.querySelector("#verification-panel").classList.contains("hidden")');
 await click('#change-email');assert(await evaluate('!document.querySelector("#account-entry").classList.contains("hidden")'));
 await evaluate('const base=Date.now();Date.now=()=>base+61000');
 // Create a verified fixture session with no profile, then follow the real login redirect.
 await evaluate('window.__mock.db.profiles=window.__mock.db.profiles.filter(row=>row.id!==window.__mock.me);window.__mock.db.onboarding_drafts=[];window.__mock.persist()');
 await call('Page.navigate',{url:'http://127.0.0.1:8765/auth.html'});await wait('document.querySelector("#auth-form")&&window.__mock');
 await evaluate('document.querySelector("#email-input").value="fresh@example.com";document.querySelector("#password-input").value="long passphrase";document.querySelector("#auth-form").requestSubmit()');
 await wait('location.pathname==="/onboarding.html"&&document.querySelector("#setup-next")&&!document.querySelector("#setup-next").disabled');
 await evaluate('document.querySelector("#display-name-input").value="A long but sensible display name";document.querySelector("#display-name-input").dispatchEvent(new Event("input"));document.querySelector("#username-input").value="ALICE";document.querySelector("#username-input").dispatchEvent(new Event("input"))');
 await wait('document.querySelector("#username-availability").textContent.includes("taken")');await click('#setup-next');assert.equal(await evaluate('location.hash'),'#identity');
 await evaluate('document.querySelector("#username-input").value="New_Josh";document.querySelector("#username-input").dispatchEvent(new Event("input"))');await wait('document.querySelector("#username-availability").textContent.includes("available")');assert.equal(await evaluate('document.querySelector("#username-input").value'),'new_josh');
 for(const width of [320,360,375,390,412,430,768,1280,1600]){await size(width,780);assert(await evaluate('document.documentElement.scrollWidth<=innerWidth'),'Identity overflow '+width);await screenshot(width+'-setup-identity');}
 await size(390,410);await evaluate('document.querySelector("#username-input").focus();document.querySelector("#setup-next").scrollIntoView({block:"end",behavior:"instant"})');assert(await evaluate('document.querySelector("#setup-next").getBoundingClientRect().bottom<=innerHeight+1'),'Keyboard-height CTA inaccessible');await size(390,844);
 await click('#setup-next');await wait('location.hash==="#interests"');await call('Page.reload');await wait('location.hash==="#interests"&&!document.querySelector("#setup-next").disabled');assert.equal(await evaluate('document.querySelector("#username-input").value'),'new_josh');
 await click('[data-category="movie"]');await click('[data-category="anime"]');await click('[data-category="football"]');
 await evaluate('window.__mock.failOnboarding=true');await click('#setup-next');await wait('document.querySelector("#onboarding-error").textContent.includes("Reconnect")');assert.equal(await evaluate('location.hash'),'#interests');await evaluate('window.__mock.failOnboarding=false');await click('#setup-next');await wait('location.hash==="#taste"');
 await click('.taste-chip');await evaluate('history.back()');await wait('location.hash==="#interests"');assert.equal(await evaluate('document.querySelectorAll(".interest-card[aria-pressed=true]").length'),3);await click('#setup-next');await wait('location.hash==="#taste"');assert(await evaluate('document.querySelector(".taste-chip[aria-pressed=true]")'));
 for(const width of [320,375,412,768,1280]){await size(width,780);assert(await evaluate('document.documentElement.scrollWidth<=innerWidth'),'Taste overflow '+width);await screenshot(width+'-setup-taste');}
 await evaluate('window.__mock.failCatalog=true');await click('#setup-next');await wait('location.hash==="#favorites"&&document.querySelector("#favorite-status").textContent.includes("unavailable")');
 await click('#skip-favorites');await wait('location.pathname==="/app.html"&&location.hash==="#home"&&document.querySelector("#profile-display-name").textContent==="A long but sensible display name"');
 assert(await evaluate('window.__mock.db.profiles.find(row=>row.id===window.__mock.me).onboarding_completed'));assert.equal(await evaluate('window.__mock.db.onboarding_drafts.length'),0);assert(await evaluate('!localStorage.getItem("kaidra:setup:"+window.__mock.me)'));
 await route('friends');await wait('document.querySelector(".friend-card")');await route('inbox');await click('.conversation-row');await wait('document.querySelector(".message-bubble")');await send('Fresh identity can chat');await wait('window.__mock.db.messages.some(row=>row.content==="Fresh identity can chat")');
 assert.deepEqual(errors,[]);console.log('PASS fresh signup validation/duplicate guard/verification refresh, username conflict, resume after reload, failed-save recovery, Back, optional unavailable favorites, completion, social identity, and mobile widths 320–1600.');
} catch(error){await screenshot('onboarding-failure').catch(()=>{});console.error(error);console.error('Runtime errors:',errors);process.exitCode=1;}
finally{ws.close();server.close();browserProcess?.kill();}
