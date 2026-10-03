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
 await route('settings');await evaluate('navigator.serviceWorker.ready');await wait('navigator.serviceWorker.controller');await evaluate('window.__promptCalls=0;const event=new Event("beforeinstallprompt");event.prompt=async()=>{window.__promptCalls++};event.userChoice=Promise.resolve({outcome:"dismissed"});window.dispatchEvent(event)');await click('#install-app-btn');await wait('window.__promptCalls===1');await click('#install-app-btn');await wait('document.querySelector(".social-modal:not(.hidden)")?.textContent.includes("Install Kaidra")');await clickText('.social-modal button','Got it');
 await evaluate('navigator.serviceWorker.ready');await wait('navigator.serviceWorker.controller');
 const manifest=await call('Page.getAppManifest');assert.deepEqual(manifest.errors,[]);assert.equal(JSON.parse(manifest.data).display,'standalone');
 assert.deepEqual(await evaluate('(async()=>{const cache=await caches.open("kaidra-offline-v1");return (await cache.keys()).map(request=>new URL(request.url).pathname).sort()})()'),['/assets/app-icon-192.png','/assets/app-icon-512.png','/assets/app-icon-maskable.png','/offline.html']);
 await new Promise(done=>{server.close(done);server.closeAllConnections();});await call('Page.reload',{ignoreCache:true});await wait('document.title==="Reconnect — Kaidra"');
 await new Promise(done=>server.listen(8765,'127.0.0.1',done));await click('button');await wait('document.querySelector("#profile-display-name")?.textContent==="Josh"');
 console.log('PASS install guidance, browser manifest validation, private-data-free cache, offline fallback and reconnect.');
 assert.deepEqual(errors,[]);
} catch(error){console.error(error);console.error('Runtime errors:',errors);process.exitCode=1;}
finally{ws.close();server.close();browserProcess?.kill();}
