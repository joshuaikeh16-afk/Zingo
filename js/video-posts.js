// Short-form user video posts. Videos are uploaded to the private
// post-videos bucket, recorded in posts, then shown only to the author and
// accepted friends through signed URLs.
import {
  supabase,
  requireAuth,
  requireProfile,
  uploadVideoPost,
  deleteVideoPostUpload,
  deleteVideoPost,
  createVideoPost,
  getFriendsVideoPosts,
  getSignedMediaUrl,
  getVideoEngagement,
  togglePostLike,
  toggleVideoSave,
  getComments,
  addComment,
  recordVideoShare,
  getUserVideoActivity,
  searchAudioTracks,
  getFollowState,
  toggleFollow,
} from './supabase-client.js';

const MAX_BYTES = 100 * 1024 * 1024;
const MAX_DURATION_SECONDS = 180;

const modal = document.getElementById('video-post-modal');
const openButtons = [
  document.getElementById('open-video-post-btn'),
];
const closeButton = document.getElementById('close-video-post-btn');
const fileInput = document.getElementById('video-post-input');
const preview = document.getElementById('video-post-preview');
const imagePreview = document.getElementById('image-post-preview');
const editorStage = document.getElementById('video-editor-stage');
const editorOverlay = document.getElementById('video-editor-overlay');
const editorSticker = document.getElementById('video-editor-sticker');
const fileName = document.getElementById('video-post-file-name');
const trimControls = document.getElementById('video-trim-controls');
const trimStartInput = document.getElementById('video-trim-start');
const trimEndInput = document.getElementById('video-trim-end');
const trimLabel = document.getElementById('video-trim-label');
const overlayTextInput = document.getElementById('video-post-overlay-text');
const overlayLayersEl = document.getElementById('video-overlay-layers');
const addOverlayButton = document.getElementById('add-video-overlay-btn');
const studioTextTrackLane = document.getElementById('studio-text-track-lane');
const stickerInput = document.getElementById('video-post-sticker');
const filterInput = document.getElementById('video-post-filter');
const musicTitleInput = document.getElementById('video-post-music-title');
const musicArtistInput = document.getElementById('video-post-music-artist');
const openAudioPickerButton = document.getElementById('open-audio-picker-btn');
const audioDrawer = document.getElementById('video-audio-drawer');
const closeAudioPickerButton = document.getElementById('close-audio-picker-btn');
const audioSearchInput = document.getElementById('video-audio-search-input');
const audioResults = document.getElementById('video-audio-results');
const originalSoundButton = document.getElementById('use-original-sound-btn');
const selectedSoundTitle = document.getElementById('video-selected-sound-title');
const selectedSoundMeta = document.getElementById('video-selected-sound-meta');
const studioMediaClip = document.getElementById('studio-media-clip');
const studioMediaClipLabel = document.getElementById('studio-media-clip-label');
const studioAudioClip = document.getElementById('studio-audio-clip');
const studioTimelineDuration = document.getElementById('studio-timeline-duration');
const studioSplitMarkers = document.getElementById('studio-split-markers');
const studioSplitButton = document.getElementById('studio-split-button');
const studioPlayhead = document.getElementById('studio-playhead');
const tagsInput = document.getElementById('video-post-tags');
const captionInput = document.getElementById('video-post-caption');
const errorEl = document.getElementById('video-post-error');
const submitButton = document.getElementById('submit-video-post-btn');
const feed = document.getElementById('fyp-video-feed');
const emptyState = document.getElementById('fyp-video-empty-state');
const commentsModal = document.getElementById('video-comments-modal');
const commentsList = document.getElementById('video-comments-list');
const commentForm = document.getElementById('video-comment-form');
const commentInput = document.getElementById('video-comment-input');
const activityModal = document.getElementById('video-activity-modal');
const activityList = document.getElementById('video-activity-list');
const shareDrawer = document.getElementById('video-share-drawer');
const shareOptions = document.getElementById('video-share-options');
const closeShareButton = document.getElementById('close-video-share-btn');

let currentUserId = null;
let selectedFile = null;
let selectedDuration = null;
let selectedMediaType = 'video';
let trimStart = 0;
let trimEnd = 0;
let selectedAudio = { id: 'original', title: 'Original sound', artist: 'Your video', previewUrl: null, source: 'original' };
let audioPreview = null;
let splitMarkers = [];
let audioCategory = 'for-you';
let previewUrl = null;
let feedObserver = null;
let openCommentsPostId = null;
let openCommentsCreatorId = null;
let overlayLayers = [];
let activeOverlayId = null;
let longPressTimer = null;

function newOverlay(text = '') {
  const duration = Math.max(1, Number(selectedDuration || 5));
  return { id: crypto.randomUUID(), text, start: 0, end: duration };
}

function activeOverlay() {
  return overlayLayers.find((layer) => layer.id === activeOverlayId) || overlayLayers[0];
}

function renderOverlayControls() {
  if (!overlayLayersEl) return;
  overlayLayersEl.innerHTML = '';
  overlayLayers.forEach((layer, index) => {
    const row = document.createElement('div');
    row.className = `video-overlay-layer${layer.id === activeOverlayId ? ' active' : ''}`;
    row.innerHTML = `<input class="video-caption-input video-short-input" maxlength="90" value="${layer.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')}" placeholder="Text layer ${index + 1}" /><button type="button" class="video-overlay-remove" aria-label="Remove text layer">×</button><div class="video-overlay-duration"><span>${layer.start.toFixed(1)}s</span><input class="overlay-start" type="range" min="0" max="${Math.max(1, selectedDuration || 5)}" step="0.1" value="${layer.start}" /><input class="overlay-end" type="range" min="0" max="${Math.max(1, selectedDuration || 5)}" step="0.1" value="${layer.end}" /><span>${layer.end.toFixed(1)}s</span></div>`;
    const textInput = row.querySelector('input[type="text"], input:not([type])');
    textInput?.addEventListener('input', () => { layer.text = textInput.value; activeOverlayId = layer.id; updateEditorPreview(); });
    row.addEventListener('click', () => { activeOverlayId = layer.id; renderOverlayControls(); });
    row.querySelector('.video-overlay-remove')?.addEventListener('click', (event) => {
      event.stopPropagation(); overlayLayers = overlayLayers.filter((item) => item.id !== layer.id); activeOverlayId = overlayLayers[0]?.id || null; renderOverlayControls(); updateEditorPreview();
    });
    const startInput = row.querySelector('.overlay-start');
    const endInput = row.querySelector('.overlay-end');
    startInput?.addEventListener('input', () => { layer.start = Math.min(Number(startInput.value), layer.end - 0.1); renderOverlayControls(); updateEditorPreview(); });
    endInput?.addEventListener('input', () => { layer.end = Math.max(Number(endInput.value), layer.start + 0.1); renderOverlayControls(); updateEditorPreview(); });
    overlayLayersEl.appendChild(row);
  });
  renderTextTimeline();
}

function renderTextTimeline() {
  if (!studioTextTrackLane) return;
  const duration = Math.max(1, Number(selectedDuration || 5));
  studioTextTrackLane.innerHTML = '';
  overlayLayers.forEach((layer, index) => {
    const clip = document.createElement('div');
    clip.className = 'studio-text-clip';
    clip.style.left = `${(layer.start / duration) * 100}%`;
    clip.style.width = `${Math.max(2, ((layer.end - layer.start) / duration) * 100)}%`;
    clip.textContent = layer.text || `Text ${index + 1}`;
    studioTextTrackLane.appendChild(clip);
  });
}

function getPostOverlayLayers(post) {
  if (Array.isArray(post.overlay_layers) && post.overlay_layers.length) return post.overlay_layers;
  return post.overlay_text ? [{ text: post.overlay_text, start: 0, end: Number(post.media_duration_seconds || 180) }] : [];
}

function renderFeedOverlays(card, post, currentTime) {
  card.querySelectorAll('.fyp-timed-overlay').forEach((element) => element.remove());
  getPostOverlayLayers(post).filter((layer) => layer.text && currentTime >= Number(layer.start || 0) && currentTime <= Number(layer.end || 999999)).forEach((layer) => {
    const element = document.createElement('div');
    element.className = 'fyp-video-overlay-text fyp-timed-overlay';
    element.textContent = layer.text;
    card.appendChild(element);
  });
}

async function copyVideoLink(postId) {
  const link = `${window.location.origin}/app.html?video=${encodeURIComponent(postId)}`;
  try { await navigator.clipboard.writeText(link); }
  catch { window.prompt('Copy this Kaidra video link:', link); }
}

function downloadVideo(url, postId) {
  const link = document.createElement('a');
  link.href = url;
  link.download = `kaidra-video-${postId}.mp4`;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function setError(message = '') {
  if (!errorEl) return;
  errorEl.textContent = message;
  errorEl.classList.toggle('hidden', !message);
}

function resetComposer() {
  selectedFile = null;
  selectedDuration = null;
  selectedMediaType = 'video';
  trimStart = 0;
  trimEnd = 0;
  splitMarkers = [];
  overlayLayers = [];
  activeOverlayId = null;
  selectedAudio = { id: 'original', title: 'Original sound', artist: 'Your video', previewUrl: null, source: 'original' };
  audioPreview?.pause();
  audioPreview = null;
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null;
  if (fileInput) fileInput.value = '';
  if (preview) { preview.pause(); preview.removeAttribute('src'); preview.load(); preview.classList.add('hidden'); }
  if (imagePreview) { imagePreview.removeAttribute('src'); imagePreview.classList.add('hidden'); }
  editorStage?.classList.remove('filter-soft', 'filter-mono', 'filter-vivid');
  editorOverlay?.classList.add('hidden');
  if (editorSticker) { editorSticker.textContent = ''; editorSticker.classList.add('hidden'); }
  if (fileName) { fileName.textContent = ''; fileName.classList.add('hidden'); }
  trimControls?.classList.add('hidden');
  if (overlayTextInput) overlayTextInput.value = '';
  renderOverlayControls();
  if (musicTitleInput) musicTitleInput.value = '';
  if (musicArtistInput) musicArtistInput.value = '';
  if (selectedSoundTitle) selectedSoundTitle.textContent = 'Add sound';
  if (selectedSoundMeta) selectedSoundMeta.textContent = 'Browse the Kaidra audio library';
  if (tagsInput) tagsInput.value = '';
  if (stickerInput) stickerInput.value = '';
  if (filterInput) filterInput.value = 'none';
  if (studioMediaClip) { studioMediaClip.style.left = '0%'; studioMediaClip.style.right = '0%'; }
  if (studioSplitMarkers) studioSplitMarkers.innerHTML = '';
  updateTimeline();
  if (captionInput) captionInput.value = '';
  if (submitButton) { submitButton.disabled = true; submitButton.textContent = 'Post video'; }
  setError();
}

function openComposer() {
  if (!currentUserId) return;
  resetComposer();
  fileInput?.click();
}

function closeComposer() {
  modal?.classList.add('hidden');
  resetComposer();
}

function updateEditorPreview() {
  if (editorOverlay) editorOverlay.innerHTML = '';
  const currentTime = preview && Number.isFinite(preview.currentTime) ? preview.currentTime : 0;
  overlayLayers.filter((layer) => layer.text.trim() && currentTime >= layer.start && currentTime <= layer.end).forEach((layer) => {
    const overlay = document.createElement('div');
    overlay.className = 'video-editor-overlay-layer';
    overlay.textContent = layer.text;
    editorOverlay?.appendChild(overlay);
  });
  editorOverlay?.classList.toggle('hidden', !editorOverlay?.children.length);
  if (editorSticker) {
    editorSticker.textContent = stickerInput?.value || '';
    editorSticker.classList.toggle('hidden', !editorSticker.textContent);
  }
  editorStage?.classList.remove('filter-soft', 'filter-mono', 'filter-vivid');
  if (filterInput?.value && filterInput.value !== 'none') editorStage?.classList.add(`filter-${filterInput.value}`);
}

function updateTrimLabel() {
  if (trimLabel) trimLabel.textContent = `${trimStart.toFixed(1)}s – ${trimEnd.toFixed(1)}s`;
}

function updateTimeline() {
  const duration = selectedDuration || 30;
  if (studioTimelineDuration) studioTimelineDuration.textContent = `${Math.floor(duration / 60).toString().padStart(2, '0')}:${Math.floor(duration % 60).toString().padStart(2, '0')}`;
  if (studioMediaClip) {
    studioMediaClip.style.left = `${Math.max(0, Math.min(100, (trimStart / duration) * 100))}%`;
    studioMediaClip.style.right = `${Math.max(0, Math.min(100, 100 - (trimEnd / duration) * 100))}%`;
  }
  if (studioMediaClipLabel) studioMediaClipLabel.textContent = selectedFile?.name || 'Your clip';
  if (studioAudioClip) studioAudioClip.querySelector('span').textContent = `♫ ${selectedAudio.title || 'Original sound'}`;
  if (studioSplitMarkers) {
    studioSplitMarkers.innerHTML = splitMarkers.map((marker) => `<i class="studio-split-marker" style="left:${(marker / duration) * 100}%"></i>`).join('');
  }
}

function closeAudioPicker() {
  audioDrawer?.classList.add('hidden');
  audioPreview?.pause();
}

function selectAudio(track) {
  selectedAudio = track;
  if (musicTitleInput) musicTitleInput.value = track.title === 'Original sound' ? '' : (track.title || '');
  if (musicArtistInput) musicArtistInput.value = track.artist === 'Your video' ? '' : (track.artist || '');
  if (selectedSoundTitle) selectedSoundTitle.textContent = track.title || 'Original sound';
  if (selectedSoundMeta) selectedSoundMeta.textContent = track.artist || track.source || 'Kaidra audio library';
  updateTimeline();
  closeAudioPicker();
}

function renderAudioResults(tracks) {
  if (!audioResults) return;
  audioResults.innerHTML = '';
  if (!tracks.length) {
    audioResults.innerHTML = '<p class="video-audio-empty">No sounds found. Try another search.</p>';
    return;
  }
  tracks.forEach((track) => {
    const row = document.createElement('article');
    row.className = 'video-audio-row';
    const info = document.createElement('div');
    info.className = 'video-audio-track-info';
    info.innerHTML = `<strong>${track.title || 'Untitled sound'}</strong><small>${track.artist || track.source || 'Kaidra library'}</small>`;
    const previewButton = document.createElement('button');
    previewButton.type = 'button';
    previewButton.className = 'video-audio-preview-button';
    previewButton.textContent = '▶';
    previewButton.disabled = !track.previewUrl;
    previewButton.title = track.previewUrl ? 'Preview sound' : 'Preview unavailable';
    previewButton.addEventListener('click', () => {
      if (!track.previewUrl) return;
      audioPreview?.pause();
      audioPreview = new Audio(track.previewUrl);
      audioPreview.play().catch(() => {});
      previewButton.textContent = 'Ⅱ';
      audioPreview.addEventListener('ended', () => { previewButton.textContent = '▶'; }, { once: true });
    });
    const useButton = document.createElement('button');
    useButton.type = 'button';
    useButton.className = 'video-audio-use-button';
    useButton.textContent = 'Use';
    useButton.addEventListener('click', () => selectAudio(track));
    row.append(previewButton, info, useButton);
    audioResults.appendChild(row);
  });
}

let audioSearchTimer = null;
async function runAudioSearch() {
  if (!audioResults) return;
  audioResults.innerHTML = '<p class="video-audio-empty">Searching sounds…</p>';
  try { renderAudioResults(await searchAudioTracks(audioSearchInput?.value || '')); }
  catch { audioResults.innerHTML = '<p class="video-audio-empty">Audio search is unavailable right now.</p>'; }
}

function makeComment(comment, creatorId = openCommentsCreatorId) {
  const row = document.createElement('article');
  row.className = 'video-comment';
  const name = document.createElement('div');
  name.className = 'video-comment-author';
  const nameText = document.createElement('strong');
  nameText.textContent = comment.profiles?.display_name || comment.profiles?.username || 'Kaidra member';
  name.appendChild(nameText);
  if (comment.user_id === creatorId) {
    const badge = document.createElement('span');
    badge.className = 'video-comment-creator-badge';
    badge.textContent = 'Creator';
    badge.setAttribute('aria-label', 'Video creator');
    name.appendChild(badge);
  }
  const content = document.createElement('p');
  content.textContent = comment.content;
  row.append(name, content);
  return row;
}

async function openComments(postId, creatorId = openCommentsCreatorId) {
  openCommentsPostId = postId;
  if (creatorId) openCommentsCreatorId = creatorId;
  commentsModal?.classList.remove('hidden');
  if (!commentsList) return;
  commentsList.innerHTML = '<p class="video-comments-empty">Loading comments…</p>';
  try {
    const comments = await getComments(postId);
    commentsList.innerHTML = '';
    if (!comments.length) commentsList.innerHTML = '<p class="video-comments-empty">No comments yet. Start the conversation.</p>';
    else comments.forEach((comment) => commentsList.appendChild(makeComment(comment, openCommentsCreatorId)));
  } catch (error) {
    console.error('Failed to load comments:', error);
    commentsList.innerHTML = '<p class="video-comments-empty">Comments are unavailable. Apply the engagement migration and try again.</p>';
  }
}

commentForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const content = commentInput?.value.trim();
  if (!openCommentsPostId || !content || !currentUserId) return;
  const submit = commentForm.querySelector('button[type="submit"]');
  if (submit) submit.disabled = true;
  const optimistic = { id: `local-${Date.now()}`, user_id: currentUserId, content, created_at: new Date().toISOString(), profiles: null };
  const optimisticRow = makeComment(optimistic, openCommentsCreatorId);
  commentsList?.querySelector('.video-comments-empty')?.remove();
  commentsList?.appendChild(optimisticRow);
  commentInput && (commentInput.value = '');
  try {
    await addComment(openCommentsPostId, currentUserId, content);
    await openComments(openCommentsPostId);
  } catch (error) {
    console.error('Failed to post comment:', error);
    optimisticRow.remove();
    if (commentInput) commentInput.value = content;
    window.alert(error.message || 'Could not post your comment. Please try again.');
  } finally {
    if (submit) submit.disabled = false;
  }
});

document.getElementById('close-video-comments-btn')?.addEventListener('click', () => {
  commentsModal?.classList.add('hidden');
  openCommentsPostId = null;
  openCommentsCreatorId = null;
});

async function shareVideo(post, card, engagement) {
  const url = `${window.location.origin}/app.html?video=${encodeURIComponent(post.id)}`;
  try {
    // On phones, let Android/iOS render the real system share sheet. This
    // provides the contact carousel and installed-app actions shown in the
    // reference screenshots.
    if (navigator.share) {
      await navigator.share({ title: 'Kaidra video', text: post.caption || 'Watch this video on Kaidra', url });
    } else {
      await navigator.clipboard.writeText(url);
      openShareDrawer(post, url, engagement || { likeCount: 0, commentCount: 0, saved: false }, card);
    }
    await recordVideoShare(post.id, currentUserId, navigator.share ? 'native' : 'clipboard');
  } catch (error) { if (error.name !== 'AbortError') console.error('Share failed:', error); }
}

function closeShareDrawer() { shareDrawer?.classList.add('hidden'); }

function shareOption(label, icon, handler) {
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'video-share-option';
  button.innerHTML = `<span>${icon}</span><strong>${label}</strong>`;
  button.addEventListener('click', async () => { await handler(); closeShareDrawer(); });
  shareOptions?.appendChild(button);
}

function openShareDrawer(post, url, engagement, card) {
  if (!shareOptions) return;
  shareOptions.innerHTML = '';
  shareOption('Send to Friends', '✉', () => document.dispatchEvent(new CustomEvent('kaidra:video-forward-request', { detail: { post, url } })));
  shareOption('Copy Link', '⧉', () => copyVideoLink(post.id));
  if (post.allow_download !== false) shareOption('Download', '⇩', () => downloadVideo(url, post.id));
  if (post.user_id === currentUserId) shareOption('Insights', '▥', () => window.alert(`Likes: ${engagement.likeCount}\nComments: ${engagement.commentCount}\nSaved: ${engagement.saved ? 'Yes' : 'No'}`));
  shareOption('Add to Status', '＋', () => window.alert('This video is ready to add to your next status.'));
  if (post.music_title || post.music_url) shareOption('Save Sound', '♫', () => {
    const savedSounds = JSON.parse(localStorage.getItem('kaidra:saved-sounds') || '[]');
    const sound = { title: post.music_title || 'Original sound', artist: post.music_artist || 'Kaidra creator', url: post.music_url || '' };
    localStorage.setItem('kaidra:saved-sounds', JSON.stringify([sound, ...savedSounds.filter((item) => item.title !== sound.title)].slice(0, 50)));
  });
  shareOption('Not Interested', '−', () => { card?.remove(); });
  shareOption('Report', '⚑', () => window.alert('Thanks. Reports are reviewed against Kaidra’s community guidelines.'));
  shareDrawer.classList.remove('hidden');
}

function showLongPressMenu(card, post, media, url) {
  card.querySelector('.fyp-longpress-menu')?.remove();
  const menu = document.createElement('div');
  menu.className = 'fyp-longpress-menu';
  menu.innerHTML = `<div class="fyp-longpress-handle"></div><div class="fyp-menu-group fyp-menu-primary"></div><div class="fyp-menu-group fyp-menu-tools"></div>`;
  const primary = menu.querySelector('.fyp-menu-primary');
  const tools = menu.querySelector('.fyp-menu-tools');
  const addMenuItem = (parent, label, icon, handler) => { const button = document.createElement('button'); button.type = 'button'; button.className = 'fyp-menu-row'; button.innerHTML = `<span class="fyp-menu-icon">${icon}</span><span>${label}</span>`; button.addEventListener('click', (event) => { event.stopPropagation(); handler(); menu.remove(); }); parent.appendChild(button); };
  addMenuItem(primary, 'Download', '⇩', () => downloadVideo(url, post.id));
  addMenuItem(primary, 'Not interested', '♡', () => card.remove());
  addMenuItem(primary, 'Report', '⚠', () => window.alert('Thanks. Reports are reviewed against Kaidra’s community guidelines.'));
  const speedRow = document.createElement('div');
  speedRow.className = 'fyp-speed-row';
  speedRow.innerHTML = '<span class="fyp-menu-icon">◉</span><strong>Speed</strong><div class="fyp-speed-options"></div>';
  [['0.5×', .5], ['1.0×', 1], ['1.5×', 1.5], ['2.0×', 2]].forEach(([label, rate]) => { const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.className = media.playbackRate === rate ? 'active' : ''; button.addEventListener('click', (event) => { event.stopPropagation(); if (media.tagName === 'VIDEO') media.playbackRate = rate; speedRow.querySelectorAll('button').forEach((item) => item.classList.toggle('active', item === button)); }); speedRow.querySelector('.fyp-speed-options').appendChild(button); });
  tools.appendChild(speedRow);
  addMenuItem(tools, 'Clear display', '⌗', () => card.classList.toggle('is-clear-display'));
  addMenuItem(tools, 'Auto scroll', '⇧', () => feed?.scrollTo({ top: card.offsetTop + card.offsetHeight, behavior: 'smooth' }));
  addMenuItem(tools, 'Captions and translation', 'Aa', () => window.alert('Captions and translation will appear when this video provides caption data.'));
  addMenuItem(tools, 'Picture-in-Picture', '▣', () => { if (media.requestPictureInPicture) media.requestPictureInPicture().catch(() => {}); });
  addMenuItem(tools, 'Background audio', '◖', () => { if (media.tagName === 'VIDEO') { media.muted = false; media.play().catch(() => {}); } });
  card.appendChild(menu);
}

closeShareButton?.addEventListener('click', closeShareDrawer);
shareDrawer?.addEventListener('click', (event) => { if (event.target === shareDrawer) closeShareDrawer(); });

function readVideoMetadata(file) {
  return new Promise((resolve, reject) => {
    const testVideo = document.createElement('video');
    const url = URL.createObjectURL(file);
    testVideo.preload = 'metadata';
    testVideo.onloadedmetadata = () => { URL.revokeObjectURL(url); resolve(testVideo.duration); };
    testVideo.onerror = () => { URL.revokeObjectURL(url); reject(new Error('This video could not be read. Try another file.')); };
    testVideo.src = url;
  });
}

function normalizeTags(value) {
  return [...new Set((value || '').split(',').map((tag) => tag.trim().replace(/^#/, '').replace(/\s+/g, '-').toLowerCase()).filter(Boolean))].slice(0, 8);
}

fileInput?.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  setError();
  if (!file) return;
  const isVideo = file.type.startsWith('video/');
  const isImage = file.type.startsWith('image/');
  if (!isVideo && !isImage) { setError('Choose a video or image file.'); fileInput.value = ''; return; }
  if (file.size > MAX_BYTES) { setError('Media must be 100 MB or smaller.'); fileInput.value = ''; return; }

  try {
    const duration = isVideo ? await readVideoMetadata(file) : 0;
    if (isVideo && (!Number.isFinite(duration) || duration <= 0)) throw new Error('This video could not be read. Try another file.');
    if (isVideo && duration > MAX_DURATION_SECONDS) { setError('Videos can be up to 3 minutes long.'); fileInput.value = ''; return; }
    selectedFile = file;
    selectedMediaType = isVideo ? 'video' : 'image';
    selectedDuration = isVideo ? Math.round(duration) : null;
    trimStart = 0;
    trimEnd = duration;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(file);
    if (preview) { preview.src = isVideo ? previewUrl : ''; preview.classList.toggle('hidden', !isVideo); }
    if (imagePreview) { imagePreview.src = isImage ? previewUrl : ''; imagePreview.classList.toggle('hidden', !isImage); }
    trimControls?.classList.toggle('hidden', !isVideo);
    if (trimStartInput) { trimStartInput.max = String(duration); trimStartInput.value = '0'; }
    if (trimEndInput) { trimEndInput.max = String(duration); trimEndInput.value = String(duration); }
    updateTrimLabel();
    updateTimeline();
    if (fileName) { fileName.textContent = `${file.name}${isVideo ? ` · ${selectedDuration}s` : ' · photo'}`; fileName.classList.remove('hidden'); }
    modal?.classList.remove('hidden');
    if (submitButton) submitButton.disabled = false;
  } catch (error) {
    setError(error.message || 'This video could not be read. Try another file.');
    fileInput.value = '';
  }
});

[overlayTextInput, stickerInput, filterInput].forEach((input) => input?.addEventListener('input', updateEditorPreview));
addOverlayButton?.addEventListener('click', () => {
  const layer = newOverlay(); overlayLayers.push(layer); activeOverlayId = layer.id; renderOverlayControls(); updateEditorPreview();
});
document.querySelectorAll('[data-studio-focus]').forEach((button) => {
  button.addEventListener('click', () => document.getElementById(button.dataset.studioFocus)?.focus());
});
document.querySelectorAll('[data-studio-panel="sounds"]').forEach((button) => button.addEventListener('click', () => openAudioPickerButton?.click()));
document.querySelectorAll('[data-studio-action="change-media"]').forEach((button) => button.addEventListener('click', () => fileInput?.click()));
studioSplitButton?.addEventListener('click', () => {
  const duration = selectedDuration || 0;
  const currentTime = preview && Number.isFinite(preview.currentTime) ? preview.currentTime : (trimStart + trimEnd) / 2;
  if (duration && currentTime > trimStart && currentTime < trimEnd) {
    splitMarkers = [...new Set([...splitMarkers, Number(currentTime.toFixed(1))])].sort((a, b) => a - b);
    updateTimeline();
  }
});
document.getElementById('studio-preview-button')?.addEventListener('click', () => {
  if (!preview || selectedMediaType !== 'video') return;
  preview.currentTime = trimStart;
  preview.muted = false;
  preview.play().catch(() => {});
});
preview?.addEventListener('timeupdate', updateEditorPreview);
openAudioPickerButton?.addEventListener('click', () => {
  audioDrawer?.classList.remove('hidden');
  if (audioSearchInput) audioSearchInput.focus();
  if (audioResults?.querySelector('.video-audio-empty')) runAudioSearch();
});
closeAudioPickerButton?.addEventListener('click', closeAudioPicker);
originalSoundButton?.addEventListener('click', () => selectAudio({ id: 'original', title: 'Original sound', artist: 'Your video', previewUrl: null, source: 'original' }));
audioDrawer?.addEventListener('click', (event) => { if (event.target === audioDrawer) closeAudioPicker(); });
audioSearchInput?.addEventListener('input', () => {
  clearTimeout(audioSearchTimer);
  audioSearchTimer = setTimeout(runAudioSearch, 250);
});
document.querySelectorAll('[data-audio-filter]').forEach((button) => {
  button.addEventListener('click', () => {
    audioCategory = button.dataset.audioFilter || 'for-you';
    document.querySelectorAll('[data-audio-filter]').forEach((item) => item.classList.toggle('active', item === button));
    if (audioCategory === 'original') selectAudio({ id: 'original', title: 'Original sound', artist: 'Your video', previewUrl: null, source: 'original' });
    else if (audioCategory === 'favorites') {
      if (audioResults) audioResults.innerHTML = '<p class="video-audio-empty">Your favorite sounds will appear here.</p>';
    } else runAudioSearch();
  });
});
trimStartInput?.addEventListener('input', () => {
  trimStart = Math.min(Number(trimStartInput.value), trimEnd - 0.1);
  trimStartInput.value = String(Math.max(0, trimStart));
  updateTrimLabel();
  updateTimeline();
});
trimEndInput?.addEventListener('input', () => {
  trimEnd = Math.max(Number(trimEndInput.value), trimStart + 0.1);
  trimEndInput.value = String(Math.min(selectedDuration || trimEnd, trimEnd));
  updateTrimLabel();
  updateTimeline();
});

async function renderVideoFeed() {
  if (!feed || !currentUserId) return;
  feedObserver?.disconnect();
  feed.innerHTML = '<p class="fyp-video-loading">Loading your For You feed…</p>';
  try {
    const posts = await getFriendsVideoPosts(currentUserId);
    const resolved = await Promise.all(posts.map(async (post) => ({
      post,
      url: post.media_url?.startsWith('http') ? post.media_url : await getSignedMediaUrl('post-videos', post.media_url),
    })));
    const playable = resolved.filter(({ url }) => url);
    feed.innerHTML = '';
    emptyState?.classList.toggle('hidden', playable.length !== 0);
    for (const { post, url } of playable) {
      const card = document.createElement('article');
      card.className = 'fyp-video-card';
      card.dataset.postId = post.id;
      const media = post.media_type === 'image' ? document.createElement('img') : document.createElement('video');
      media.src = url;
      media.className = post.media_type === 'image' ? 'fyp-video-image' : '';
      if (post.media_type !== 'image') {
        // Request sound-on autoplay. Browsers may still block it until the
        // first user gesture; in that case playback remains silent without
        // adding a separate “tap for sound” control.
        media.muted = false;
        media.autoplay = true;
        media.loop = true;
        media.playsInline = true;
        media.preload = 'auto';
        media.addEventListener('loadedmetadata', () => { media.currentTime = Number(post.trim_start_seconds || 0); });
        media.addEventListener('timeupdate', () => {
          if (post.trim_end_seconds && media.currentTime >= post.trim_end_seconds) {
            media.currentTime = Number(post.trim_start_seconds || 0);
            if (!media.paused) media.play().catch(() => {});
          }
          renderFeedOverlays(card, post, media.currentTime);
        });
        media.addEventListener('click', () => {
          media.muted = !media.muted;
          if (media.paused) media.play().catch(() => {});
          card.classList.toggle('is-unmuted', !media.muted);
        });
      }
      media.setAttribute('aria-label', post.media_type === 'image' ? 'Image post' : 'Video post');
      if (post.filter_name && post.filter_name !== 'none') card.classList.add(`filter-${post.filter_name}`);
      card.prepend(media);
      const info = document.createElement('div');
      info.className = 'fyp-video-card-info';
      const author = document.createElement('span');
      author.className = 'fyp-video-author';
      author.textContent = post.profiles?.display_name || post.profiles?.username || 'Kaidra member';
      info.appendChild(author);
      if (post.caption) {
        const caption = document.createElement('p');
        caption.className = 'fyp-video-caption';
        caption.textContent = post.caption;
        info.appendChild(caption);
      }
      if (post.tags?.length) {
        const tags = document.createElement('p');
        tags.className = 'fyp-video-tags';
        tags.textContent = post.tags.map((tag) => `#${tag}`).join(' ');
        info.appendChild(tags);
      }
      if (post.music_title || post.music_artist) {
        const sound = document.createElement('div');
        sound.className = 'fyp-video-sound';
        sound.textContent = `♫ ${post.music_title || 'Original sound'}${post.music_artist ? ` · ${post.music_artist}` : ''}`;
        info.appendChild(sound);
      }
      if (post.overlay_text && !post.overlay_layers?.length) {
        const overlay = document.createElement('div');
        overlay.className = 'fyp-video-overlay-text';
        overlay.textContent = post.overlay_text;
        card.appendChild(overlay);
      }
      if (post.sticker) {
        const sticker = document.createElement('span');
        sticker.className = 'fyp-video-sticker';
        sticker.textContent = post.sticker;
        card.appendChild(sticker);
      }
      const [engagement, initiallyFollowing] = await Promise.all([
        getVideoEngagement(post.id, currentUserId),
        getFollowState(currentUserId, post.user_id).catch(() => false),
      ]);
      if (post.media_type !== 'image') {
        media.addEventListener('loadedmetadata', () => renderFeedOverlays(card, post, media.currentTime));
        renderFeedOverlays(card, post, 0);
      }
      const startLongPress = (event) => {
        if (event.target.closest('button, select, a')) return;
        longPressTimer = window.setTimeout(() => showLongPressMenu(card, post, media, url), 520);
      };
      const cancelLongPress = () => { if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; } };
      card.addEventListener('pointerdown', startLongPress);
      card.addEventListener('pointerup', cancelLongPress);
      card.addEventListener('pointercancel', cancelLongPress);
      card.addEventListener('pointerleave', cancelLongPress);
      const actions = document.createElement('div');
      actions.className = 'fyp-actions';
      const creator = document.createElement('div');
      creator.className = 'fyp-creator-follow';
      const creatorAvatar = document.createElement('img');
      const creatorName = post.profiles?.display_name || post.profiles?.username || 'Kaidra member';
      creatorAvatar.src = post.profiles?.avatar_url || `https://placehold.co/96x96/202447/e9eaff?text=${encodeURIComponent(creatorName[0]?.toUpperCase() || 'K')}`;
      creatorAvatar.alt = `${creatorName} profile`;
      creatorAvatar.className = 'fyp-creator-avatar';
      creator.appendChild(creatorAvatar);
      if (post.user_id !== currentUserId) {
        const followButton = document.createElement('button');
        followButton.type = 'button';
        followButton.className = `fyp-follow-plus${initiallyFollowing ? ' is-following' : ''}`;
        followButton.textContent = initiallyFollowing ? '✓' : '+';
        followButton.setAttribute('aria-label', initiallyFollowing ? `Following ${creatorName}` : `Follow ${creatorName}`);
        followButton.addEventListener('click', async (event) => {
          event.stopPropagation();
          followButton.disabled = true;
          try {
            const nowFollowing = await toggleFollow(currentUserId, post.user_id);
            followButton.classList.toggle('is-following', nowFollowing);
            followButton.textContent = nowFollowing ? '✓' : '+';
            followButton.setAttribute('aria-label', nowFollowing ? `Following ${creatorName}` : `Follow ${creatorName}`);
          } catch (error) {
            console.error('Follow action failed:', error);
            window.alert('Following is unavailable until the social graph migration is applied.');
          } finally {
            followButton.disabled = false;
          }
        });
        creator.appendChild(followButton);
      }
      const makeAction = (icon, label, count, active, handler) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `fyp-action-btn${active ? ' active' : ''}`;
        const iconEl = document.createElement('span'); iconEl.className = 'fyp-action-icon'; iconEl.textContent = icon;
        const labelEl = document.createElement('span'); labelEl.textContent = count == null ? label : String(count);
        button.append(iconEl, labelEl); button.addEventListener('click', handler);
        return button;
      };
      const likeButton = makeAction('♥', 'Like', engagement.likeCount, engagement.liked, async () => {
        const liked = await togglePostLike(post.id, currentUserId);
        engagement.likeCount += liked ? 1 : -1;
        likeButton.classList.toggle('active', liked);
        likeButton.lastElementChild.textContent = String(engagement.likeCount);
      });
      const commentButton = makeAction('◌', 'Comment', engagement.commentCount, false, () => openComments(post.id, post.user_id));
      const saveButton = makeAction('⌑', engagement.saved ? 'Saved' : 'Save', null, engagement.saved, async () => {
        saveButton.disabled = true;
        try {
          const saved = await toggleVideoSave(post.id, currentUserId);
          saveButton.classList.toggle('active', saved);
          saveButton.lastElementChild.textContent = saved ? 'Saved' : 'Save';
        } catch (error) {
          console.error('Failed to save video:', error);
          window.alert('Could not save this video. Run the video engagement migration in Supabase first.');
        } finally {
          saveButton.disabled = false;
        }
      });
      const shareButton = makeAction('↗', 'Share', null, false, () => shareVideo(post, card, engagement));
      // Keep the initial rail limited to the four primary TikTok-style
      // interactions. Secondary actions live in the Share drawer.
      actions.append(likeButton, commentButton, saveButton, shareButton);
      card.append(info, creator, actions);
      if (post.user_id === currentUserId) {
        const deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.className = 'fyp-delete-btn';
        deleteButton.textContent = 'Delete';
        deleteButton.addEventListener('click', async (event) => {
          event.stopPropagation();
          if (!window.confirm('Delete this video? This cannot be undone.')) return;
          deleteButton.disabled = true;
          try {
            await deleteVideoPost(currentUserId, post.id, post.media_url);
            card.remove();
            if (!feed.children.length) emptyState?.classList.remove('hidden');
          } catch (error) {
            console.error('Failed to delete video:', error);
            deleteButton.disabled = false;
            window.alert('Could not delete this video. Please try again.');
          }
        });
        card.appendChild(deleteButton);
      }
      feed.appendChild(card);
    }
    feedObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        const video = entry.target.querySelector('video');
        if (!video) return;
        if (entry.isIntersecting && entry.intersectionRatio >= 0.7) video.play().catch(() => {});
        else video.pause();
      });
    }, { root: feed, threshold: [0, 0.7, 1] });
    feed.querySelectorAll('.fyp-video-card').forEach((card) => feedObserver.observe(card));
  } catch (error) {
    console.error('Failed to load friend videos:', error);
    feed.innerHTML = '<p class="fyp-video-loading">Videos are unavailable right now.</p>';
    emptyState?.classList.add('hidden');
  }
}

submitButton?.addEventListener('click', async () => {
  if (!selectedFile || !currentUserId) return;
  setError();
  submitButton.disabled = true;
  submitButton.textContent = 'Uploading…';
  let uploadedPath = null;
  try {
    uploadedPath = await uploadVideoPost(currentUserId, selectedFile);
    await createVideoPost(currentUserId, {
      mediaPath: uploadedPath,
      mediaType: selectedMediaType,
      caption: captionInput?.value.trim() || '',
      overlayText: overlayTextInput?.value.trim() || '',
      overlayLayers: overlayLayers.filter((layer) => layer.text.trim()).map(({ id, ...layer }) => layer),
      allowDownload: document.getElementById('video-post-allow-download')?.checked !== false,
      musicTitle: musicTitleInput?.value.trim() || '',
      musicArtist: musicArtistInput?.value.trim() || '',
      musicUrl: selectedAudio.previewUrl || '',
      tags: normalizeTags(tagsInput?.value),
      sticker: stickerInput?.value || '',
      filterName: filterInput?.value || 'none',
      trimStartSeconds: selectedMediaType === 'video' ? trimStart : null,
      trimEndSeconds: selectedMediaType === 'video' ? trimEnd : null,
      durationSeconds: selectedDuration,
    });
    closeComposer();
    await renderVideoFeed();
  } catch (error) {
    // Avoid leaving an orphaned private object if the database insert fails.
    await deleteVideoPostUpload(uploadedPath).catch(() => {});
    console.error('Failed to post video:', error);
    setError(error.message || 'Your video could not be posted. Try again.');
    submitButton.disabled = false;
    submitButton.textContent = 'Post video';
  }
});

openButtons.forEach((button) => button?.addEventListener('click', openComposer));
closeButton?.addEventListener('click', closeComposer);
modal?.addEventListener('click', (event) => { if (event.target === modal) closeComposer(); });
document.addEventListener('kaidra:home-mode-change', (event) => {
  if (event.detail.mode !== 'fyp') feed?.querySelectorAll('video').forEach((video) => video.pause());
});

(async () => {
  const session = await requireAuth();
  if (!session) return;
  const profile = await requireProfile(session);
  if (!profile) return;
  currentUserId = session.user.id;
  await renderVideoFeed();
})();
