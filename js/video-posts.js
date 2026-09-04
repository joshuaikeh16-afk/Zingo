// Short-form user video posts. Videos are uploaded to the private
// post-videos bucket, recorded in posts, then shown only to the author and
// accepted friends through signed URLs.
import {
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
const fileName = document.getElementById('video-post-file-name');
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

let currentUserId = null;
let selectedFile = null;
let selectedDuration = null;
let previewUrl = null;
let feedObserver = null;
let openCommentsPostId = null;

function setError(message = '') {
  if (!errorEl) return;
  errorEl.textContent = message;
  errorEl.classList.toggle('hidden', !message);
}

function resetComposer() {
  selectedFile = null;
  selectedDuration = null;
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null;
  if (fileInput) fileInput.value = '';
  if (preview) { preview.pause(); preview.removeAttribute('src'); preview.load(); preview.classList.add('hidden'); }
  if (fileName) { fileName.textContent = ''; fileName.classList.add('hidden'); }
  if (captionInput) captionInput.value = '';
  if (submitButton) { submitButton.disabled = true; submitButton.textContent = 'Post video'; }
  setError();
}

function openComposer() {
  if (!currentUserId) return;
  resetComposer();
  modal?.classList.remove('hidden');
}

function closeComposer() {
  modal?.classList.add('hidden');
  resetComposer();
}

function makeComment(comment) {
  const row = document.createElement('article');
  row.className = 'video-comment';
  const name = document.createElement('strong');
  name.textContent = comment.profiles?.display_name || comment.profiles?.username || 'Kaidra member';
  const content = document.createElement('p');
  content.textContent = comment.content;
  row.append(name, content);
  return row;
}

async function openComments(postId) {
  openCommentsPostId = postId;
  commentsModal?.classList.remove('hidden');
  if (!commentsList) return;
  commentsList.innerHTML = '<p class="video-comments-empty">Loading comments…</p>';
  const comments = await getComments(postId);
  commentsList.innerHTML = '';
  if (!comments.length) commentsList.innerHTML = '<p class="video-comments-empty">No comments yet. Start the conversation.</p>';
  else comments.forEach((comment) => commentsList.appendChild(makeComment(comment)));
}

async function shareVideo(post) {
  const url = `${window.location.origin}/app.html?video=${encodeURIComponent(post.id)}`;
  try {
    if (navigator.share) await navigator.share({ title: 'Kaidra video', text: post.caption || 'Watch this video on Kaidra', url });
    else await navigator.clipboard.writeText(url);
    await recordVideoShare(post.id, currentUserId, navigator.share ? 'native' : 'clipboard');
  } catch (error) { if (error.name !== 'AbortError') console.error('Share failed:', error); }
}

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

fileInput?.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  setError();
  if (!file) return;
  if (!file.type.startsWith('video/')) { setError('Choose a video file.'); fileInput.value = ''; return; }
  if (file.size > MAX_BYTES) { setError('Videos must be 100 MB or smaller.'); fileInput.value = ''; return; }

  try {
    const duration = await readVideoMetadata(file);
    if (!Number.isFinite(duration) || duration <= 0) throw new Error('This video could not be read. Try another file.');
    if (duration > MAX_DURATION_SECONDS) { setError('Videos can be up to 3 minutes long.'); fileInput.value = ''; return; }
    selectedFile = file;
    selectedDuration = Math.round(duration);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(file);
    if (preview) { preview.src = previewUrl; preview.classList.remove('hidden'); }
    if (fileName) { fileName.textContent = `${file.name} · ${selectedDuration}s`; fileName.classList.remove('hidden'); }
    if (submitButton) submitButton.disabled = false;
  } catch (error) {
    setError(error.message || 'This video could not be read. Try another file.');
    fileInput.value = '';
  }
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
      const video = document.createElement('video');
      video.src = url;
      video.muted = true;
      video.autoplay = true;
      video.loop = true;
      video.playsInline = true;
      video.preload = 'auto';
      video.setAttribute('aria-label', 'Video post');
      video.addEventListener('click', () => {
        video.muted = !video.muted;
        if (video.paused) video.play().catch(() => {});
        card.classList.toggle('is-unmuted', !video.muted);
      });
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
      const soundHint = document.createElement('span');
      soundHint.className = 'fyp-sound-hint';
      soundHint.textContent = 'Tap for sound';
      const engagement = await getVideoEngagement(post.id, currentUserId);
      const actions = document.createElement('div');
      actions.className = 'fyp-actions';
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
      const commentButton = makeAction('◌', 'Comment', engagement.commentCount, false, () => openComments(post.id));
      const saveButton = makeAction('⌑', engagement.saved ? 'Saved' : 'Save', null, engagement.saved, async () => {
        const saved = await toggleVideoSave(post.id, currentUserId);
        saveButton.classList.toggle('active', saved);
        saveButton.lastElementChild.textContent = saved ? 'Saved' : 'Save';
      });
      const shareButton = makeAction('↗', 'Share', null, false, () => shareVideo(post));
      actions.append(likeButton, commentButton, saveButton, shareButton);
      card.append(video, info, soundHint, actions);
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
      caption: captionInput?.value.trim() || '',
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
