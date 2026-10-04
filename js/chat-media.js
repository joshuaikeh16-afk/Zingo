import { supabase, getSignedMediaUrl } from './supabase-client.js';
import { element, iconButton, actionButton, notify } from './ui.js';
import { dialog, openMenu } from './context-menu.js';
import { registerMessageContent } from './message-content.js';
import { voicePlayer } from './voice-player.js';

const MB=1024*1024;
export const mediaBucket=type=>type==='image'?'chat-images':type==='voice_note'?'voice-notes':'chat-media';
export function mediaSpec(file,kind='auto') {
  const mime=file.type.split(';')[0],images={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif'},videos={'video/mp4':'mp4','video/webm':'webm'};
  if(!file.size)throw new Error('This file is empty.');
  if(kind==='sticker'){if(!['image/webp','image/png','image/gif'].includes(mime)||file.size>2*MB)throw new Error('Import WebP, PNG or GIF stickers under 2 MB each.');return {type:'sticker',ext:images[mime],mime};}
  if(kind!=='document'&&images[mime]){if(file.size>5*MB)throw new Error('Photos must be under 5 MB.');return {type:'image',ext:images[mime],mime};}
  if(kind!=='document'&&videos[mime]){if(file.size>25*MB)throw new Error('Videos must be under 25 MB.');return {type:'video',ext:videos[mime],mime};}
  if(kind==='auto')throw new Error('Choose a JPG, PNG, WebP, GIF, MP4 or WebM.');
  const docs={'application/pdf':'pdf','text/plain':'txt','application/zip':'zip','application/msword':'doc','application/vnd.openxmlformats-officedocument.wordprocessingml.document':'docx','application/vnd.ms-excel':'xls','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'xlsx','application/vnd.ms-powerpoint':'ppt','application/vnd.openxmlformats-officedocument.presentationml.presentation':'pptx','application/octet-stream':'bin'};
  if(!docs[mime]||file.size>20*MB)throw new Error('Choose a PDF, text, ZIP or Office document under 20 MB.');
  return {type:'document',ext:docs[mime],mime};
}
export async function uploadMedia(cid,file,id,kind='auto') {
  const spec=mediaSpec(file,kind),path=`${cid}/${id}.${spec.ext}`;
  const {error}=await supabase.storage.from(mediaBucket(spec.type)).upload(path,file,{contentType:spec.mime});
  if(error&&!['409','Duplicate'].includes(String(error.statusCode||error.error)))throw error;
  return {message_type:spec.type,media_url:path,media_metadata:{name:file.name.slice(0,150),mime:spec.mime,size:file.size}};
}
export function installMediaRenderers() {
  registerMessageContent('voice_note',(message,context)=>voicePlayer(message,context.members?.find(p=>p.id===message.sender_id)));
  for(const type of ['image','sticker','video'])registerMessageContent(type,message=>{
    if(type==='sticker'&&!message.media_url)return element('div','message-bubble',message.content||'Sticker unavailable');
    const node=element(type==='video'?'video':'img',type==='sticker'?'chat-sticker':'chat-media');
    if(type==='video'){node.controls=true;node.playsInline=true;node.preload='metadata';node.setAttribute('aria-label','Shared video');}else{node.alt=type==='sticker'?'Sticker':message.media_metadata?.name||'Shared photo';node.loading='lazy';}
    getSignedMediaUrl(mediaBucket(type),message.media_url||message.content).then(url=>{if(url)node.src=url;else node.replaceWith(element('p','muted','Media is unavailable.'));}).catch(()=>node.replaceWith(element('p','muted','Media is unavailable.')));
    node.addEventListener('error',()=>{node.replaceWith(element('p','muted','This media could not load.'));},{once:true});return node;
  });
  registerMessageContent('document',message=>{
    const card=element('div','chat-document'),name=element('strong','',message.media_metadata?.name||'Document'),download=actionButton('Download','download'),size=Number(message.media_metadata?.size||0);card.append(name,element('small','muted',size?`${(size/MB).toFixed(1)} MB`:'File'),download);
    download.addEventListener('click',async()=>{download.disabled=true;try{const {data,error}=await supabase.storage.from('chat-media').createSignedUrl(message.media_url,300,{download:message.media_metadata?.name||'attachment'});if(error||!data)throw error;const link=document.createElement('a');link.href=data.signedUrl;link.download=message.media_metadata?.name||'attachment';link.rel='noopener';link.click();}catch{notify('Could not download this file. Try again.');}finally{download.disabled=false;}});return card;
  });
}
export function mediaPicker({getActive,onFile}) {
  function pick(kind='auto',capture){const state=getActive();if(!state)return;const input=element('input');input.type='file';input.accept=kind==='document'?'.pdf,.txt,.zip,.doc,.docx,.xls,.xlsx,.ppt,.pptx':capture==='video'?'video/mp4,video/webm':capture==='photo'?'image/*':'image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm';if(capture)input.setAttribute('capture','environment');input.addEventListener('change',()=>{const file=input.files[0];if(file)onFile(state,file,kind);});input.click();}
  document.getElementById('composer-attachment').addEventListener('click',e=>openMenu(e.currentTarget,[{label:'Gallery · photos and videos',icon:'image',run:()=>pick()},{label:'Document',icon:'file',run:()=>pick('document')}],'Attachments'));
  document.getElementById('composer-camera').addEventListener('click',e=>openMenu(e.currentTarget,[{label:'Gallery · photos and videos',icon:'image',run:()=>pick()},{label:'Take photo',icon:'camera',run:()=>pick('auto','photo')},{label:'Record video',icon:'film',run:()=>pick('auto','video')}],'Photos and videos'));
}
export async function stickerPicker({userId,getActive,onSticker}) {
  const panel=dialog('Your stickers','sticker-picker'),grid=element('div','sticker-grid'),error=element('p','form-error'),importButton=actionButton('Import stickers','download');panel.card.append(element('p','muted','Import saved or exported WebP, PNG or GIF files, including WhatsApp stickers. Animated files stay animated. Up to 2 MB each.'),importButton,error,grid);panel.open();let busy=false;
  async function load(){grid.replaceChildren(element('p','muted','Loading stickers…'));try{const {data,error:problem}=await supabase.from('user_stickers').select('*').eq('user_id',userId).order('created_at',{ascending:false}).limit(200);if(problem)throw problem;if(!panel.modal.isConnected)return;grid.replaceChildren();if(!data.length)grid.append(element('p','muted','Your collection starts with an import.'));
    for(const item of data){const cell=element('div','sticker-cell'),send=element('button','sticker-send'),image=element('img'),remove=iconButton('trash','Remove sticker');send.type='button';send.setAttribute('aria-label',`Send ${item.label}`);image.alt=item.label;image.loading='lazy';send.append(image);getSignedMediaUrl('user-stickers',item.path).then(url=>{if(url)image.src=url;}).catch(()=>{});send.addEventListener('click',async()=>{if(busy)return;const state=getActive();if(!state)return;busy=true;send.disabled=true;try{const id=crypto.randomUUID(),path=`${state.id}/${id}.${item.path.split('.').at(-1)}`;const {data,error:problem}=await supabase.storage.from('user-stickers').download(item.path);if(problem)throw problem;const file=new File([data],item.label,{type:data.type});const media=await uploadMedia(state.id,file,id,'sticker');await onSticker(state,{id,...media});panel.close();}catch(problem){error.textContent=problem.message||'Could not send sticker.';}finally{busy=false;send.disabled=false;}});
      remove.addEventListener('click',async()=>{if(busy)return;busy=true;remove.disabled=true;try{const result=await supabase.from('user_stickers').delete().eq('id',item.id).eq('user_id',userId);if(result.error)throw result.error;await supabase.storage.from('user-stickers').remove([item.path]);cell.remove();}catch{error.textContent='Could not remove sticker.';}finally{busy=false;remove.disabled=false;}});cell.append(send,remove);grid.append(cell);}
  }catch{grid.replaceChildren();error.textContent='Could not load your stickers. Try opening the picker again.';}}
  importButton.addEventListener('click',()=>{if(busy)return;const input=element('input');input.type='file';input.multiple=true;input.accept='.webp,.png,.gif';input.addEventListener('change',async()=>{busy=true;importButton.disabled=true;error.textContent='';let imported=0;for(const file of [...input.files].slice(0,50)){let path;try{const spec=mediaSpec(file,'sticker'),id=crypto.randomUUID();path=`${userId}/${id}.${spec.ext}`;const result=await supabase.storage.from('user-stickers').upload(path,file,{contentType:spec.mime});if(result.error)throw result.error;const saved=await supabase.from('user_stickers').insert({id,user_id:userId,path,label:file.name.slice(0,100)||'Sticker'});if(saved.error)throw saved.error;imported++;}catch(problem){if(path)await supabase.storage.from('user-stickers').remove([path]).catch(()=>{});error.textContent=problem.message||'Some stickers could not be imported.';}}notify(`${imported} sticker${imported===1?'':'s'} imported`);busy=false;importButton.disabled=false;await load();});input.click();});await load();
}
