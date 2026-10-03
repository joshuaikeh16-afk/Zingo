import { dialog } from './context-menu.js';
import { element, actionButton, notify } from './ui.js';
let installPrompt;
const standalone=()=>matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
const button=document.getElementById('install-app-btn'),status=document.getElementById('install-app-status');
function render(){if(!button)return;button.classList.toggle('hidden',standalone());if(status)status.textContent=standalone()?'Kaidra is installed on this device.':'';}
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;render();});
window.addEventListener('appinstalled',()=>{installPrompt=null;render();notify('Kaidra is installed.');});
button?.addEventListener('click',async()=>{
 if(installPrompt){const prompt=installPrompt;installPrompt=null;try{await prompt.prompt();await prompt.userChoice;render();}catch{if(status)status.textContent='Installation could not start. Try your browser menu or refresh.';}return;}
 const panel=dialog('Install Kaidra'),ios=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
 panel.card.append(element('p','muted',ios?'Open Kaidra in your browser, tap Share, then Add to Home Screen.':'Open your browser menu and choose Install app or Add to Home Screen. On desktop, look for the install icon in the address bar.'));
 const done=actionButton('Got it','check','primary-button');done.addEventListener('click',panel.close);panel.card.append(done);panel.open();
});
render();
if('serviceWorker' in navigator&&isSecureContext){
 navigator.serviceWorker.register('/sw.js',{updateViaCache:'none'}).then(registration=>{
  // Let a new worker activate on next launch rather than reload a draft or recording.
  if(registration.waiting&&standalone()&&status)status.textContent='An update is ready. Close and reopen Kaidra to load it.';
 }).catch(()=>{if(status)status.textContent='Install support could not load. Refresh to try again.';});
}
