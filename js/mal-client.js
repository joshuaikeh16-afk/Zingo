import { supabase } from './supabase-client.js';

async function malRequest(action, payload = {}) {
  const { data, error } = await supabase.functions.invoke('mal-api', {
    body: { action, ...payload },
  });
  if (error) {
    let detail = '';
    try {
      const responseBody = await error.context?.json();
      detail = responseBody?.error || responseBody?.message || '';
    } catch {
      detail = '';
    }
    throw new Error(`MAL API unavailable (${action}). ${detail || error.message || 'Check the deployed function logs.'}`);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

export const searchMAL = (query, type = 'anime', limit = 12) => malRequest('search', { query, type, limit });
export const getMALDetail = (id, type = 'anime') => malRequest('detail', { id, type });
export const getMALRanking = (type = 'anime', rankingType = 'bypopularity', limit = 12) => malRequest('ranking', { type, rankingType, limit });
export const getMALGenre = (genre, year = 'all', limit = 20, offset = 0) => malRequest('genre', { genre, sort_year: year, limit, offset });
export const getMALSeasonal = (year, season, limit = 12) => malRequest('seasonal', { year, season, limit });
export const getMALUpcoming = (limit = 12) => malRequest('upcoming', { limit });
export const getMALRecommendations = (id, limit = 12) => malRequest('recommendations', { id, limit });

export async function getMALAnimeList(status = '', limit = 50) {
  return malRequest('my-list', { status, limit });
}

export async function updateMALListEntry(id, fields) {
  return malRequest('update-list', { id, fields });
}

export async function deleteMALListEntry(id) {
  return malRequest('delete-list', { id });
}

function redirectUri() {
  return `${window.location.origin}${window.location.pathname}`;
}

function randomVerifier() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
}

export async function connectMAL() {
  const verifier = randomVerifier();
  const state = randomVerifier();
  sessionStorage.setItem('kaidra:mal-oauth', JSON.stringify({ verifier, state, redirectUri: redirectUri() }));
  const result = await malRequest('authorize-url', {
    redirectUri: redirectUri(),
    state,
    codeChallenge: verifier,
  });
  window.location.assign(result.url);
}

export async function finishMALAuth() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const saved = JSON.parse(sessionStorage.getItem('kaidra:mal-oauth') || 'null');
  if (!code || !saved || params.get('state') !== saved.state) return null;
  const token = await malRequest('oauth-token', {
    code,
    codeVerifier: saved.verifier,
    redirectUri: saved.redirectUri,
  });
  const result = await malRequest('connect', { token });
  sessionStorage.removeItem('kaidra:mal-oauth');
  window.history.replaceState({}, document.title, window.location.pathname);
  return result;
}

export async function isMALConnected(userId) {
  const result = await malRequest('connection-status');
  return result.connection || null;
}
