import { showError, notify } from './ui.js';

const MAX_SECONDS = 180;
export function installVoiceNotes({ getActive, onBusy, onSend }) {
  const mic = document.getElementById('voice-record-btn'), panel = document.getElementById('voice-recorder');
  const timer = document.getElementById('voice-duration'), label = document.getElementById('voice-status');
  const player = document.getElementById('voice-preview'), stop = document.getElementById('voice-stop-btn'), send = document.getElementById('voice-send-btn');
  let recorder, stream, interval, started = 0, duration = 0, blob, previewUrl, version = 0, phase = 'idle';
  const supported = isSecureContext && navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';
  mic.disabled = !supported;
  if (!supported) mic.title = 'Voice recording needs HTTPS or localhost and a supported browser';
  function release() {
    clearInterval(interval); interval = null;
    stream?.getTracks().forEach(track => track.stop()); stream = null;
  }
  function cancel() {
    ++version; const current = recorder; recorder = null;
    if (current?.state !== 'inactive' && current) current.stop();
    release(); blob = null; phase = 'idle';
    player.pause(); player.removeAttribute('src'); player.load();
    if (previewUrl) URL.revokeObjectURL(previewUrl); previewUrl = null;
    panel.classList.add('hidden'); mic.disabled = !supported; mic.setAttribute('aria-pressed', 'false'); onBusy(false);
  }
  function tick() {
    duration = Math.min(MAX_SECONDS, Math.max(1, Math.ceil((performance.now() - started) / 1000)));
    timer.textContent = `${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, '0')}`;
    if (duration >= MAX_SECONDS) stopRecording();
  }
  function stopRecording() {
    if (recorder?.state === 'recording') { tickWithoutStop(); recorder.stop(); release(); stop.disabled = true; label.textContent = 'Preparing your recording…'; }
  }
  function tickWithoutStop() { duration = Math.min(MAX_SECONDS, Math.max(1, Math.ceil((performance.now() - started) / 1000))); }
  mic.addEventListener('click', async () => {
    const state = getActive(); if (!state || !supported || phase !== 'idle') return;
    const request = ++version; phase = 'permission'; mic.disabled = true; onBusy(true); showError('chat-error');
    try {
      const acquired = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
      if (request !== version || getActive() !== state) { acquired.getTracks().forEach(track => track.stop()); if (request === version) cancel(); return; }
      stream = acquired;
      const mimeType = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm'].find(type => MediaRecorder.isTypeSupported(type));
      recorder = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 64000 });
      const parts = []; let bytes = 0;
      recorder.addEventListener('dataavailable', event => { if (event.data.size) { parts.push(event.data); bytes += event.data.size; if (bytes > 10 * 1024 * 1024) { cancel(); showError('chat-error', 'That recording is too large. Try a shorter voice note.'); } } });
      recorder.addEventListener('stop', () => {
        if (request !== version) return;
        release(); blob = new Blob(parts, { type: mimeType || parts[0]?.type || 'audio/webm' });
        if (!blob.size) { cancel(); showError('chat-error', 'No audio was recorded. Check your microphone and try again.'); return; }
        phase = 'preview'; panel.dataset.phase = phase; label.textContent = 'Listen before sending'; player.classList.remove('hidden');
        previewUrl = URL.createObjectURL(blob); player.src = previewUrl; stop.classList.add('hidden'); send.classList.remove('hidden'); send.disabled = false;
      });
      recorder.addEventListener('error', () => { if (request === version) { cancel(); showError('chat-error', 'Recording stopped unexpectedly. Please try again.'); } });
      phase = 'recording'; panel.dataset.phase = phase; panel.classList.remove('hidden');
      label.textContent = 'Recording · up to 3 minutes'; player.classList.add('hidden'); stop.classList.remove('hidden'); stop.disabled = false; send.classList.add('hidden');
      mic.setAttribute('aria-pressed', 'true'); started = performance.now(); duration = 1; timer.textContent = '0:00'; recorder.start(250); interval = setInterval(tick, 250);
      stop.focus();
    } catch (error) {
      if (request !== version) return; cancel();
      showError('chat-error', error.name === 'NotAllowedError' ? 'Allow microphone access in your browser to record a voice note.' : error.name === 'NotFoundError' ? 'No microphone was found on this device.' : 'Your microphone could not start. Check it and try again.');
    }
  });
  stop.addEventListener('click', stopRecording);
  document.getElementById('voice-discard-btn').addEventListener('click', () => { cancel(); mic.focus(); });
  send.addEventListener('click', () => {
    if (phase !== 'preview' || !blob || !getActive()) return;
    const recording = blob, seconds = duration; cancel(); onSend(recording, seconds);
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden && phase === 'recording') { stopRecording(); notify('Recording stopped. Your voice note is ready to review.'); } });
  window.addEventListener('pagehide', cancel);
  return { cancel };
}
