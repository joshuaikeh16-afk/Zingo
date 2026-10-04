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
try{
  console.log('Browser QA starting.');
  ws.addEventListener('message', event => { const message = JSON.parse(event.data); if (message.method === 'Page.javascriptDialogOpening') call('Page.handleJavaScriptDialog', { accept: true }); });
  await call('Runtime.enable');await call('Page.enable');await call('Network.enable');await call('Network.setCacheDisabled',{cacheDisabled:true});
  await call('Network.setBlockedURLs',{urls:['*fonts.googleapis.com*','*fonts.gstatic.com*']});
  await call('Page.navigate',{url:'about:blank'}); await call('Storage.clearDataForOrigin',{origin:'http://127.0.0.1:8765',storageTypes:'all'});
  await size(390,844); await call('Page.navigate',{url:'http://127.0.0.1:8765/app.html#home'});
  await wait('document.querySelectorAll("#recommendations-grid .content-card").length===6 && document.querySelectorAll(".conversation-row").length===2 && document.querySelectorAll(".friend-card").length===2');
  assert.deepEqual(await evaluate('[...document.querySelectorAll("#app-bottom-nav button")].map(x=>(x.querySelector(".nav-label")||x.children[1]).textContent)'),['Home','Discover','Friends','Inbox','Profile']);
  assert.equal(await evaluate('document.documentElement.dataset.theme'),'dark');
  assert.equal(await evaluate('!!document.querySelector("#setting-theme")'),false);
  assert.equal(await evaluate('document.querySelector("#content-region").value'),'NG');
  assert.equal(await evaluate('document.querySelectorAll(".conversation-row img").length'),2,'User name markup must be text');
  assert.equal(await evaluate('document.querySelectorAll(".hero-dot").length'),5);
  await click('.hero-pause'); assert.equal(await evaluate('document.querySelector(".hero-pause").getAttribute("aria-pressed")'),'true');
  await click('.hero-dot:nth-child(2)'); assert.equal(await evaluate('document.querySelector(".featured-copy h2").textContent'),'City of Echoes');
  // Dedicated object destinations and natural Back/Forward; My Profile never changes owner.
  await route('friends'); await click('.friend-card .person-identity');
  await wait('location.hash==="#user/"+window.__mock.alice && document.querySelector("#user-profile-display-name").textContent.startsWith("Alice")');
  assert.equal(await evaluate('document.querySelector("#profile-display-name").textContent'),'Josh');
  await route('profile'); await wait('document.querySelector("#profile-display-name").textContent==="Josh"');
  await evaluate('history.back()'); await wait('document.body.dataset.activeTab==="user"');
  await click('#user-back-btn'); await wait('document.body.dataset.activeTab==="friends"');
  await click('#open-global-search'); assert.equal(await evaluate('document.activeElement.id'),'global-search-input');
  await evaluate('document.querySelector("#global-search-input").value="alice";document.querySelector("#global-search-input").dispatchEvent(new Event("input"))');
  await wait('document.querySelectorAll("#global-search-results .search-result-group").length===5 && document.querySelector("#global-search-results .avatar")');
  await call('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowDown',code:'ArrowDown',windowsVirtualKeyCode:40});
  assert(await evaluate('document.activeElement.classList.contains("search-result")'));
  await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await wait('document.querySelector("#global-search-modal").classList.contains("hidden")');
  await route('discover'); await click('[data-category="football"]'); await wait('document.querySelector("#discover-grid .match-card")');
  assert.equal(await evaluate('document.body.dataset.activeTab'),'discover');
  await new Promise(resolve => setTimeout(resolve, 350));
  assert(await evaluate('!!document.querySelector("#discover-grid .match-open") && !document.querySelector("#discover-grid .content-card")'),'Background catalogue loading must not replace matches');
  await click('#discover-grid .match-open'); await wait('location.hash==="#match/1" && document.querySelector("#content-detail-body .match-visual")');
  await evaluate('history.back()'); await wait('document.querySelector("#content-detail-modal").classList.contains("hidden") && document.body.dataset.activeTab==="discover"');
  await click('[data-category="movie"]'); await wait('document.querySelector("#discover-grid .content-card")');
  await route('home'); await click('#recommendations-grid .content-open'); await wait('location.hash==="#title/movie/1" && document.querySelector(".provider-row")');
  await evaluate('history.back()'); await wait('document.querySelector("#content-detail-modal").classList.contains("hidden") && document.body.dataset.activeTab==="home"');
  await evaluate('history.forward()'); await wait('location.hash==="#title/movie/1" && !document.querySelector("#content-detail-modal").classList.contains("hidden") && document.querySelector(".provider-row")');
  await click('[data-close="content-detail-modal"]'); await wait('location.hash==="#home"');
  // Direct-link refresh restores the selected public title; failure stays local.
  await call('Page.navigate',{url:'http://127.0.0.1:8765/app.html#title/movie/1'});
  await wait('document.querySelector(".provider-row") && !document.querySelector("#content-detail-modal").classList.contains("hidden")');
  assert.equal(await evaluate('document.querySelector("#content-detail-body .detail-identity h2").textContent'),'The Last Horizon');
  await click('[data-close="content-detail-modal"]'); await wait('document.querySelector("#content-detail-modal").classList.contains("hidden")');
  await route('home'); await wait('document.querySelector("#recommendations-grid .content-open")');
  await click('#recommendations-grid .content-open'); await wait('document.querySelector(".provider-row")');
  assert.equal(await evaluate('document.querySelector(".provider-row a").href'),'https://www.netflix.com/');
  await click('[data-close="content-detail-modal"]');
  await route('discover'); await wait('document.querySelectorAll("#discover-grid .content-card").length>=6');
  await click('[data-category="tv"]'); await wait('document.querySelector("#discover-grid .content-type").textContent==="Series"');
  await evaluate('document.querySelector("#content-search").value="a story";document.querySelector("#content-search-form").requestSubmit()');
  await wait('document.querySelector("#discover-heading").textContent.includes("a story")');
  await evaluate('window.__mock.failCatalog=true;document.querySelector("#content-search-form").requestSubmit()');
  await wait('document.querySelector("#discover-grid .feed-notice button")');
  await evaluate('window.__mock.failCatalog=false'); await click('#discover-grid .feed-notice button'); await wait('document.querySelector("#discover-grid .content-card")');
  await evaluate('window.__mock.emptyCatalog=true;document.querySelector("#content-search-form").requestSubmit()'); await wait('document.querySelector("#discover-grid .empty-state")');
  assert(await evaluate('document.querySelector("#discover-grid .empty-state").textContent.includes("No titles")'));
  await evaluate('window.__mock.emptyCatalog=false;document.querySelector("#content-search-form").requestSubmit()'); await wait('document.querySelector("#discover-grid .content-card")');
  await route('friends'); await click('#find-friends-btn');
  await evaluate('document.querySelector("#find-friends-input").value="sam";document.querySelector("#find-friends-input").dispatchEvent(new Event("input"))');
  await wait('document.querySelector("#find-friends-results .person-row")'); await click('#find-friends-results .quiet-button');
  await wait('document.querySelector("#find-friends-results .quiet-button").textContent==="Cancel request"');
  await click('#find-friends-results .quiet-button'); await wait('document.querySelector("#find-friends-results .quiet-button").textContent==="Add friend"');
  await click('#find-friends-close-btn');
  await evaluate('const row={id:"incoming-request",requester_id:"new-person",target_id:window.__mock.me,status:"pending",created_at:new Date().toISOString()};window.__mock.db.friend_requests.push(row);window.__mock.emit("friend_requests","INSERT",row)');
  await wait('document.querySelector("#alerts-list").textContent.includes("wants to connect")');
  await click('#open-alerts-btn'); assert(await evaluate('document.querySelector("#alerts-list").textContent.includes("wants to connect")')); await click('#alerts-list button.notification-row');
  await wait('document.body.dataset.activeTab==="user" && document.querySelector("#friend-action-btn").textContent==="Accept request"');
  assert.equal(await evaluate('location.hash'),'#user/new-person');
  await click('#friend-action-btn'); await wait('document.querySelectorAll(".friend-card").length===3');
  await route('inbox'); await click('.conversation-row'); await wait('document.querySelectorAll("[data-message-id]").length===1');
  assert.equal(await evaluate('document.querySelector("#message-text-input").closest("[inert]")'),null,'Mobile composer must not inherit inert');
  await send('Hello Alice'); await wait('[...document.querySelectorAll(".message-bubble")].some(x=>x.textContent==="Hello Alice")');
  assert.equal(await evaluate('[...document.querySelectorAll(".message-bubble")].filter(x=>x.textContent==="Hello Alice").length'),1,'Realtime echo duplicated');
  await evaluate('window.__mock.failNextSend=true'); await send('Retry this'); await wait('document.querySelector(".message-retry")'); await click('.message-retry');
  await wait('!document.querySelector(".message-retry") && !document.querySelector(".is-sending")');
  assert.equal(await evaluate('window.__mock.db.messages.filter(x=>x.content==="Retry this").length'),1);
  await click('.message-actions [aria-label="Reply to message"]'); await send('My reply');
  assert(await evaluate('window.__mock.db.messages.find(x=>x.content==="My reply").external_ref_id'));
  await click('.message-actions [aria-label="React to message"]'); await click('.reaction-choice'); await wait('document.querySelector(".reaction-pill")');
  await click('#close-chat-btn');
  await evaluate('window.__mock.delayConversation=window.__mock.a;document.querySelectorAll(".conversation-row")[0].click();document.querySelector("#close-chat-btn").click();document.querySelectorAll(".conversation-row")[1].click()');
  await wait('document.querySelector("#dm-active-name").textContent==="Bob" && [...document.querySelectorAll(".message-bubble")].some(x=>x.textContent==="Ready for the match?")');
  await new Promise(r=>setTimeout(r,900));
  assert.equal(await evaluate('[...document.querySelectorAll(".message-bubble")].some(x=>x.textContent==="Hello Alice")'),false,'Stale thread snapshot');
  await evaluate('window.__mock.db.messages.push({id:"missed",conversation_id:window.__mock.b,sender_id:window.__mock.bob,content:"Missed during reconnect",message_type:"text",created_at:new Date().toISOString(),read_at:null});window.__mock.reconnect()');
  await wait('[...document.querySelectorAll(".message-bubble")].some(x=>x.textContent==="Missed during reconnect")');
  await click('#close-chat-btn');
  await click('#new-group-btn'); await wait('document.querySelectorAll(".group-wizard .group-friend-picker input").length===3');
  await evaluate('document.querySelectorAll(".group-wizard .group-friend-picker input")[0].click();document.querySelectorAll(".group-wizard .group-friend-picker input")[1].click()');
  await clickText('.group-wizard button','Continue'); await evaluate('document.querySelector("#group-wizard-name").value="Weekend crew";document.querySelector("#group-wizard-name").dispatchEvent(new Event("input"))'); await clickText('.group-wizard button','Create group');
  await wait('document.querySelector("#dm-active-name").textContent==="Weekend crew" && document.querySelector("#chat-view-drawer").classList.contains("is-active")');
  await send('Hey @bob'); await wait('document.querySelector(".message-mention")');
  assert(await evaluate('window.__mock.db.messages.find(row=>row.content==="Hey @bob").mention_ids.includes(window.__mock.bob)'));
  await click('#chat-info-btn'); await wait('document.querySelectorAll("#chat-members .person-row").length===3');
  assert(await evaluate('document.querySelector("#chat-members .role-badge").textContent==="Owner"'));
  await clickText('#chat-members button','Add people'); await wait('document.querySelector(".social-modal:not(.hidden):last-of-type input[type=checkbox]") || [...document.querySelectorAll(".social-modal:not(.hidden)")].some(node=>node.querySelector("input[type=checkbox]"))');
  await evaluate('[...document.querySelectorAll(".social-modal:not(.hidden) input[type=checkbox]")].at(-1).click()'); await clickText('.social-modal:not(.hidden) button','Add selected friends'); await wait('document.querySelectorAll("#chat-members .person-row").length===4');
  await click('[data-close="chat-info-modal"]');
  await click('#composer-plus'); await clickText('.context-menu button','Poll'); await wait('document.querySelector(".poll-create-modal input")');
  await evaluate('document.querySelector(".poll-create-modal input").value="Movie night?";document.querySelectorAll(".poll-option-input input")[0].value="Movie";document.querySelectorAll(".poll-option-input input")[1].value="Series";document.querySelector(".poll-create-modal form").requestSubmit()');
  await wait('document.querySelectorAll(".poll-choice").length===2'); await click('.poll-choice'); await wait('document.querySelector(".poll-choice.selected")');
  await click('.poll-choice:last-of-type'); await wait('window.__mock.db.poll_votes[0]?.choice_ids[0]===window.__mock.db.chat_polls[0].options[1].id');
  await evaluate('[...document.querySelectorAll(".message-row")].find(node=>node.querySelector(".poll-card")).querySelector(".message-actions button:last-child").click()'); await clickText('.context-menu button','Pin message'); await wait('!document.querySelector("#chat-pins").classList.contains("hidden")');
  await click('#chat-pins'); await clickText('.social-modal:not(.hidden) button','Movie night?'); await wait('document.querySelector(".message-highlight")');
  await click('#close-chat-btn');
  await route('home');
  assert.equal(await evaluate('document.querySelectorAll(".recommendation-reason,.card-share").length'),0);
  await click('#recommendations-grid .context-more'); await clickText('.context-menu button','Add to Favorites'); await wait('window.__mock.db.user_watchlist[0]?.is_favorite');
  await click('#recommendations-grid .context-more'); await clickText('.context-menu button','Add to Watchlist'); await wait('window.__mock.db.user_watchlist[0]?.is_watchlisted');
  await route('profile'); await wait('document.querySelector("#profile-favorites .content-card")'); await click('[data-library-tab="watchlist"]'); assert.equal(await evaluate('document.querySelectorAll("#profile-favorites .content-card").length'),1);
  await route('home'); await evaluate('window.__mock.failLibrary=true'); await click('#recommendations-grid .context-more'); await clickText('.context-menu button','Remove from Favorites'); await wait('document.querySelector("#app-status").textContent.includes("restored")'); assert(await evaluate('document.querySelector("#recommendations-grid .content-card").classList.contains("is-favorite")')); await evaluate('window.__mock.failLibrary=false');
  await click('#recommendations-grid .context-more'); await clickText('.context-menu button','Send to…'); await wait('document.querySelector("#new-chat-list .person-row")'); await click('#new-chat-list .person-row');
  await wait('document.querySelector("#new-chat-modal").classList.contains("hidden") && window.__mock.db.messages.some(x=>x.shared_content?.title==="The Last Horizon")');
  await evaluate('document.dispatchEvent(new CustomEvent("kaidra:navigate",{detail:{tab:"inbox/"+window.__mock.db.messages.find(x=>x.shared_content?.title==="The Last Horizon").conversation_id}}))');
  await wait('document.querySelector("#message-thread-container .rich-content-card")');
  await click('#message-thread-container .rich-content-card'); await wait('document.querySelector(".provider-row")'); await click('[data-close="content-detail-modal"]'); await click('#close-chat-btn');
  await route('home'); await wait('document.querySelector(".match-card")');
  assert(await evaluate('document.querySelector(".match-card").textContent.includes("2 – 1")'));
  await click('.match-card .context-more'); await clickText('.context-menu button','Send to…'); await wait('document.querySelector("#new-chat-list .person-row")'); await click('#new-chat-list .person-row'); await wait('window.__mock.db.messages.some(row=>row.shared_content?.kind==="match")');
  await route('profile'); await evaluate('document.dispatchEvent(new CustomEvent("kaidra:view-profile",{detail:{userId:window.__mock.me}}))'); await wait('document.querySelector("#profile-display-name").textContent==="Josh"');
  await click('#edit-profile-btn'); await evaluate('document.querySelector("#edit-profile-bio").value="Movies and matchday";document.querySelector("#edit-profile-bio").dispatchEvent(new Event("input",{bubbles:true}))');
  await click('[data-close="edit-profile-modal"]'); await wait('!document.querySelector("#discard-modal").classList.contains("hidden")'); await click('#keep-editing-btn');
  await evaluate('document.querySelector("#edit-profile-form").requestSubmit()'); await wait('document.querySelector("#profile-bio").textContent==="Movies and matchday"');
  await click('#open-settings-btn'); await evaluate('document.querySelector("#setting-allow-dms").click()'); await wait('window.__mock.db.user_preferences[0].allow_dms===false');
  await click('[data-close="settings-overlay"]');
  await evaluate('const item={id:"alert-1",user_id:window.__mock.me,title:"Kickoff soon",body:"A big match",url:"https://www.fifa.com/",created_at:new Date().toISOString(),read_at:null};window.__mock.db.app_notifications.push(item);window.__mock.emit("app_notifications","INSERT",item)');
  await wait('document.querySelector("#alerts-count").textContent==="1"'); await click('#open-alerts-btn'); await click('#mark-alerts-read'); await wait('document.querySelector("#alerts-count").classList.contains("hidden")'); await click('[data-close="alerts-modal"]');
  // Total unread items, failed read acknowledgements and recovery.
  await route('inbox');
  await evaluate('const base=Date.now()+100;for(const [id,sender,count,offset] of [[window.__mock.a,window.__mock.alice,7,0],[window.__mock.b,window.__mock.bob,3,10]])for(let i=0;i<count;i++){const message={id:crypto.randomUUID(),conversation_id:id,sender_id:sender,content:"Unread item "+i,message_type:"text",created_at:new Date(base+offset+i).toISOString(),read_at:null};window.__mock.db.messages.push(message);window.__mock.emit("messages","INSERT",message)}');
  await wait('document.querySelector("#nav-inbox-count").textContent==="10"');
  assert.equal(await evaluate('document.querySelector("#sidebar-inbox-count").textContent'),'10');
  await evaluate('[...document.querySelectorAll(".conversation-row")].find(row=>row.textContent.includes("Alice")).click()');
  await wait('document.querySelector("#nav-inbox-count").textContent==="3"');
  assert(await evaluate('![...document.querySelectorAll(".conversation-row")].find(row=>row.textContent.includes("Alice")).querySelector(".conversation-unread-badge")'));
  await click('#close-chat-btn'); await evaluate('window.__mock.failMarkRead=true;[...document.querySelectorAll(".conversation-row")].find(row=>row.textContent.includes("Bob")).click()');
  await wait('document.querySelector("#chat-error").textContent.includes("save read receipts")');
  assert.equal(await evaluate('document.querySelector("#nav-inbox-count").textContent'),'3');
  await evaluate('window.__mock.failMarkRead=false;window.__mock.reconnect()'); await wait('document.querySelector("#nav-inbox-count").classList.contains("hidden")'); await click('#close-chat-btn');
  // Real audio from Chrome's artificial microphone; retry one stable upload/message.
  await evaluate('const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);window.__mock.streams=[];navigator.mediaDevices.getUserMedia=async options=>{const stream=await original(options);window.__mock.streams.push(stream);return stream};[...document.querySelectorAll(".conversation-row")].find(row=>row.textContent.includes("Weekend crew")).click()');
  await wait('document.querySelector("#dm-active-name").textContent==="Weekend crew"');
  await evaluate('window.__mock.failNextUpload=true'); await click('#voice-record-btn'); await wait('document.querySelector("#voice-recorder").dataset.phase==="recording"');
  await new Promise(resolve=>setTimeout(resolve,750)); await click('#voice-stop-btn'); await wait('document.querySelector("#voice-recorder").dataset.phase==="preview"');
  assert(await evaluate('document.querySelector("#voice-preview").src.startsWith("blob:")'));
  await click('#voice-send-btn'); await wait('document.querySelector(".message-retry")'); await click('.message-retry');
  await wait('window.__mock.db.messages.filter(message=>message.message_type==="voice_note").length===1 && !document.querySelector(".message-retry")');
  assert(await evaluate('window.__mock.uploads.filter(upload=>upload.bucket==="voice-notes").length===2 && window.__mock.uploads.filter(upload=>upload.bucket==="voice-notes")[0].path===window.__mock.uploads.filter(upload=>upload.bucket==="voice-notes")[1].path'));
  assert(await evaluate('window.__mock.db.messages.find(message=>message.message_type==="voice_note").media_duration_seconds>=1'));
  await click('#close-chat-btn'); await evaluate('[...document.querySelectorAll(".conversation-row")].find(row=>row.textContent.includes("Weekend crew")).click()');
  await wait('document.querySelector("audio.chat-media")?.readyState>=1');
  await click('#voice-record-btn'); await wait('document.querySelector("#voice-recorder").dataset.phase==="recording"'); await click('#voice-discard-btn');
  assert(await evaluate('window.__mock.streams.every(stream=>stream.getTracks().every(track=>track.readyState==="ended"))'));
  await click('#voice-record-btn'); await wait('document.querySelector("#voice-recorder").dataset.phase==="recording"'); await click('#close-chat-btn');
  assert(await evaluate('document.querySelector("#voice-recorder").classList.contains("hidden") && window.__mock.streams.every(stream=>stream.getTracks().every(track=>track.readyState==="ended"))'));
  // Scroll and retry while keeping earlier personalized picks visible.
  await route('home'); await evaluate('document.querySelector("#home-feed-sentinel").scrollIntoView()');
  await wait('document.querySelectorAll("#home-feed-grid .content-card").length>=6');
  assert(await evaluate('window.__mock.calls.some(call=>call.action==="catalog"&&call.category==="for-you"&&call.page===2)'));
  await route('discover'); await evaluate('window.__mock.failCatalogAfterPageOne=true;scrollTo(0,0);document.querySelector("#content-search").value="paginated";document.querySelector("#content-search-form").requestSubmit()');
  await wait('document.querySelectorAll("#discover-grid .content-card").length===6');
  await evaluate('window.__mock.failCatalog=true'); await click('#load-discover-more'); await wait('document.querySelector("#load-discover-more").textContent==="Try again"');
  assert.equal(await evaluate('document.querySelectorAll("#discover-grid .content-card").length'),6);
  await evaluate('window.__mock.failCatalog=false;window.__mock.failCatalogAfterPageOne=false'); await click('#load-discover-more'); await wait('document.querySelectorAll("#discover-grid .content-card").length>=12');
  assert(await evaluate('new Set([...document.querySelectorAll("#discover-grid .content-open strong")].map(node=>node.textContent)).size>=12'));
  // Inspect all main surfaces at every requested width, plus tablet/desktop.
  console.log('Interaction checks passed; checking responsive layouts.');
  for(const width of [320,360,390,430,768,1280,1366,1600]) {
    await size(width,width === 1366 ? 768 : 900);
    for(const tab of ['home','discover','friends','inbox','profile']) {
      await route(tab);
      assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true,tab+' overflows at '+width);
      await screenshot(width+'-'+tab);
    }
    await route('inbox'); await click('.conversation-row'); await wait('document.querySelector("#chat-view-drawer").classList.contains("is-active")');
    await new Promise(resolve=>setTimeout(resolve,300));
    if (width < 1100) assert(await evaluate('Math.abs(document.querySelector("#chat-view-drawer").getBoundingClientRect().top)<1 && Math.abs(document.querySelector("#chat-view-drawer").getBoundingClientRect().height-innerHeight)<1'),'Mobile conversation should occupy the viewport');
    else assert(await evaluate('document.querySelector("#message-form").getBoundingClientRect().bottom<=innerHeight'),'Desktop composer should remain visible');
    assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true,'Chat overflows at '+width); await screenshot(width+'-chat'); await click('#close-chat-btn');
    await click('#open-alerts-btn'); assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true,'Notification overflow'); await screenshot(width+'-notifications'); await click('[data-close="alerts-modal"]');
    console.log('Responsive checks passed at '+width+'px.');
  }
  for (const width of [320,1280]) {
    await size(width); await route('profile'); await click('#open-settings-btn'); await screenshot(width+'-settings');
    assert(await evaluate('document.querySelector("#settings-overlay .social-modal-card").getBoundingClientRect().right<=innerWidth'),'Settings clipped');
    await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9}); await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
    assert(await evaluate('document.querySelector("#settings-overlay").contains(document.activeElement)'),'Modal focus escaped');
    await click('[data-close="settings-overlay"]'); await click('#edit-profile-btn'); await screenshot(width+'-edit-profile'); await click('[data-close="edit-profile-modal"]');
    await route('friends'); await click('#find-friends-btn'); await screenshot(width+'-find-people'); await click('#find-friends-close-btn');
    await route('home'); await click('#recommendations-grid .content-open'); await wait('document.querySelector(".provider-row")'); await screenshot(width+'-content-detail'); await click('[data-close="content-detail-modal"]');
  }
  await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await route('home'); assert.equal(await evaluate('getComputedStyle(document.querySelector(".hero-poster")).animationName'),'none');
  await call('Emulation.setEmulatedMedia',{features:[]});
  await route('profile'); await click('#open-settings-btn'); await click('#settings-logout-btn'); await clickText('.confirm-modal:not(.hidden) button','Log out'); await wait('location.pathname==="/auth.html" && document.querySelector("#auth-form")');
  await size(1280); await screenshot('1280-auth');
  await size(320); assert(await evaluate('document.documentElement.scrollWidth<=innerWidth'),'Auth overflow'); await screenshot('320-auth');
  await evaluate('document.querySelector("#email-input").value="qa@example.com"'); await click('#forgot-password-link'); await wait('document.querySelector("#auth-error-message").textContent.includes("Check your email")');
  await call('Page.navigate',{url:'http://127.0.0.1:8765/signup.html'}); await wait('location.pathname==="/signup.html" && document.readyState==="complete" && document.querySelector("#auth-form")'); await size(390,844);
  await evaluate('document.querySelector("#email-input").value="qa@example.com";document.querySelector("#password-input").value="safe-test-password";document.querySelector("#auth-form").requestSubmit()');
  await wait('!document.querySelector("#verification-panel").classList.contains("hidden")'); assert.equal(await evaluate('location.pathname'),'/signup.html'); await screenshot('390-signup');
  await call('Page.navigate',{url:'http://127.0.0.1:8765/auth.html'}); await wait('location.pathname==="/auth.html" && document.readyState==="complete" && document.querySelector("#auth-form")');
  await evaluate('document.querySelector("#email-input").value="qa@example.com";document.querySelector("#password-input").value="safe-test-password";document.querySelector("#auth-form").requestSubmit()'); await wait('location.pathname==="/app.html" && document.querySelector(".content-card")');
  await call('Page.navigate',{url:'http://127.0.0.1:8765/onboarding.html?edit=1'}); await wait('location.pathname==="/onboarding.html" && document.readyState==="complete" && document.querySelectorAll(".setup-step")[1] && !document.querySelectorAll(".setup-step")[1].classList.contains("hidden")'); await screenshot('390-tastes');
  await click('#setup-next'); await wait('!document.querySelectorAll(".setup-step")[2].classList.contains("hidden")'); assert.equal(await evaluate('document.querySelector("#language-input option[value=en]").textContent'),'English');
  await evaluate('document.querySelector("#country-input").value="GH";document.querySelector("#onboarding-form").requestSubmit()'); await wait('!document.querySelectorAll(".setup-step")[3].classList.contains("hidden")'); await click('#skip-favorites'); await wait('location.pathname==="/app.html" && document.querySelector(".content-card")');
  await call('Page.navigate',{url:'http://127.0.0.1:8765/reset-password.html?qa-recovery=1'}); await wait('location.pathname==="/reset-password.html" && document.readyState==="complete" && document.querySelector("#reset-form") && !document.querySelector("#reset-form").classList.contains("hidden")');
  await evaluate('document.querySelector("#new-password-input").value="password1";document.querySelector("#confirm-password-input").value="password2";document.querySelector("#reset-form").requestSubmit()'); await wait('document.querySelector("#reset-error-message").textContent.includes("do not match")');
  await evaluate('document.querySelector("#confirm-password-input").value="password1";document.querySelector("#reset-form").requestSubmit()'); await wait('document.querySelector("#reset-subtitle").textContent.includes("Password updated")');
  assert.deepEqual(errors,[],'Browser runtime exceptions');
  console.log('Browser checks passed: auth, confirmation, recovery, taste setup, hero, discovery, categories/search/retry/empty, friend requests, DM send/echo/retry/reply/reaction, stale snapshots/reconnect, groups/membership, recommendation/match shares, profiles/unsaved edits, settings, notifications, reduced motion; all main surfaces checked at 320/360/390/430/768/1280/1366/1600px. Fixtures are isolated from production.');
}catch(error){await screenshot('failure').catch(()=>{});console.error(error);console.error('Runtime errors:',errors);process.exitCode=1;}
finally{ws.close();server.close();browserProcess?.kill();}
