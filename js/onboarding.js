import { supabase, requireAuth } from './supabase-client.js';
import { element, artwork } from './ui.js';
import { contentRequest } from './content-client.js';
import { countries, genreChoices, preferencesFor } from './preferences.js';
let userId, existing = null, step = 0, favorites = [], searchTimer, searchVersion = 0, usernameVersion = 0;
const username = document.getElementById('username-input'), displayName = document.getElementById('display-name-input');
const country = document.getElementById('country-input'), language = document.getElementById('language-input');
const error = document.getElementById('onboarding-error'), submit = document.getElementById('onboarding-submit-btn');
const selected = (name) => [...document.querySelectorAll(`input[name="${name}"]:checked`)].map((input) => input.value);
function setError(message = '') { error.textContent = message; error.classList.toggle('hidden', !message); }
for (const [key,title] of countries) { const option = element('option','',title); option.value = key; country.append(option); }
for (const [key,title] of genreChoices) { const label = element('label'); const input = element('input'); input.type='checkbox';input.name='genre';input.value=key;label.append(input,document.createTextNode(title));document.getElementById('genre-choices').append(label); }
function validate() {
  if (step === 0 && !/^[a-zA-Z0-9_]{3,24}$/.test(username.value.trim())) { setError('Choose a username with 3–24 letters, numbers, or underscores.'); username.focus(); return false; }
  if (step === 1 && (!selected('content-type').length || !selected('genre').length)) { setError('Choose at least one format and one genre so we can tailor your feed.'); return false; }
  return true;
}
function showStep(next) {
  step = next; setError();
  document.querySelectorAll('[data-step]').forEach((section) => { const active=Number(section.dataset.step)===step; section.classList.toggle('hidden',!active); section.querySelectorAll('input').forEach(input=>{ if(input.id==='username-input') input.required=active; }); });
  document.querySelectorAll('[data-step-indicator]').forEach((node) => { node.classList.toggle('active',Number(node.dataset.stepIndicator)===step);node.setAttribute('aria-current',Number(node.dataset.stepIndicator)===step?'step':'false'); });
  document.getElementById('setup-back').classList.toggle('hidden',step===0);document.getElementById('setup-next').classList.toggle('hidden',step===2);submit.classList.toggle('hidden',step!==2);
  document.getElementById('setup-next').textContent=step===0?'Your taste →':'Fine-tune →';
}
document.getElementById('setup-next').addEventListener('click',()=>{if(validate())showStep(step+1);});
document.getElementById('setup-back').addEventListener('click',()=>showStep(Math.max(0,step-1)));
username.addEventListener('input',async()=>{
  const version=++usernameVersion,value=username.value.trim();if(value.length<3)return;
  const response=await supabase.from('profiles').select('id').eq('username',value).neq('id',userId).limit(1);
  if(version!==usernameVersion)return;
  document.getElementById('username-availability').textContent=response.error?'Availability will be checked when you save.':response.data.length?'That username is taken.':'Username available';
});
let previewUrl;
document.getElementById('avatar-input').addEventListener('change',event=>{
  const file=event.target.files[0];if(!file)return;
  if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>5*1024*1024){setError('Choose a JPG, PNG, or WebP under 5 MB.');event.target.value='';return;}
  if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl=URL.createObjectURL(file);
  const img=document.getElementById('avatar-preview');img.onerror=()=>{img.classList.add('hidden');setError('That photo could not be opened. Choose another image.');};img.src=previewUrl;img.classList.remove('hidden');
});
function renderFavorites(){
  const target=document.getElementById('chosen-favorites');target.replaceChildren();
  favorites.forEach(item=>{const button=element('button','favorite-chip',`${item.title} ×`);button.type='button';button.addEventListener('click',()=>{favorites=favorites.filter(value=>value.id!==item.id);renderFavorites();});target.append(button);});
}
document.getElementById('favorite-search').addEventListener('input',event=>{
  clearTimeout(searchTimer);const query=event.target.value.trim(),version=++searchVersion,target=document.getElementById('favorite-results');
  target.replaceChildren();if(query.length<2)return;
  searchTimer=setTimeout(async()=>{
    try{const data=await contentRequest('catalog',{category:'movie',query,region:country.value});if(version!==searchVersion)return;
      target.replaceChildren();if(!data.configured){target.append(element('p','muted','Movie search is not connected yet. Your genre choices are enough to continue.'));return;}
      for(const item of data.items.slice(0,5)){const button=element('button','favorite-result');button.type='button';button.append(artwork(item.image,'','favorite-artwork'));button.append(element('span','',`${item.title} · ${item.date?.slice(0,4)||''}`));
        button.addEventListener('click',()=>{if(favorites.length>=3){setError('Choose up to three favourite movies.');return;}if(!favorites.some(value=>value.id===item.id))favorites.push({id:item.id,type:item.type,title:item.title,image:item.image});renderFavorites();target.replaceChildren();document.getElementById('favorite-search').value='';});target.append(button);}
    }catch{if(version===searchVersion)target.replaceChildren(element('p','muted','Movie search is unavailable. You can add favourites later.'));}
  },350);
});
document.getElementById('onboarding-form').addEventListener('submit',async event=>{
  event.preventDefault();if(step<2){if(validate())showStep(step+1);return;}setError();submit.disabled=true;
  try{
    if(!userId)throw new Error('Sign in again to finish setting up your profile.');
    if(!/^[a-zA-Z0-9_]{3,24}$/.test(username.value.trim())){showStep(0);throw new Error('Choose a username with 3–24 letters, numbers, or underscores.');}
    if(!selected('content-type').length||!selected('genre').length){showStep(1);throw new Error('Choose at least one format and one genre.');}
    let avatarUrl=existing?.avatar_url;
    const file=document.getElementById('avatar-input').files[0];
    if(file){if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>5*1024*1024)throw new Error('Choose a JPG, PNG, or WebP under 5 MB.');
      const path=`${userId}/${crypto.randomUUID()}.${file.type.split('/')[1]}`;const upload=await supabase.storage.from('avatars').upload(path,file);if(upload.error)throw upload.error;avatarUrl=supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl;
    }
    const football=document.getElementById('interest-football-input').checked;
    const preferences={content_types:selected('content-type'),genres:selected('genre'),country:country.value,language:language.value,providers:selected('provider').map(Number),favorites};
    const interests=[...selected('content-type'),...selected('genre'),...(football?['football']:[])];
    const result=await supabase.from('profiles').upsert({id:userId,username:username.value.trim(),display_name:displayName.value.trim()||null,interests,recommendation_preferences:preferences,...(avatarUrl?{avatar_url:avatarUrl}:{})});
    if(result.error)throw result.error;
    location.replace('/app.html#home');
  }catch(problem){setError(problem.code==='23505'?'That username is already taken.':problem.message||'Could not save your preferences. Try again.');}
  finally{submit.disabled=false;}
});
(async()=>{
  const session=await requireAuth();if(!session)return;userId=session.user.id;
  const {data,error:loadError}=await supabase.from('profiles').select('*').eq('id',userId).maybeSingle();
  if(loadError){setError('Could not load your profile. Refresh to try again.');return;}
  existing=data;
  if(existing&&!new URLSearchParams(location.search).has('edit')){location.replace('/app.html');return;}
  const prefs=preferencesFor(existing||{});username.value=existing?.username||'';displayName.value=existing?.display_name||'';country.value=prefs.country;language.value=prefs.language;favorites=prefs.favorites;
  document.querySelectorAll('[name="content-type"]').forEach(input=>input.checked=prefs.content_types.includes(input.value));
  document.querySelectorAll('[name="genre"]').forEach(input=>input.checked=prefs.genres.includes(input.value));
  document.querySelectorAll('[name="provider"]').forEach(input=>input.checked=prefs.providers.map(String).includes(input.value));
  document.getElementById('interest-football-input').checked=prefs.football;renderFavorites();
  if(existing){document.title='Edit your tastes — Kaidra';showStep(1);}
})().catch(()=>setError('Could not load your account. Please sign in again.'));
