// Excel aus dem lokalen Ordner auswählen und per GitHub-API ins Repo hochladen.
// Token: fine-grained Personal Access Token (nur dieses Repo, "Contents: Read and write"),
// liegt ausschließlich im localStorage dieses Browsers.

export const REPO = 'demuHB/werderspiele';
export const BRANCH = 'main';
export const PATH = 'data/werderspiele.xlsx';
export const EXPECTED_NAME = 'Alle Werder Spiele Dennis.xlsx';
const API = 'https://api.github.com';
const TOKEN_KEY = 'ghToken';

// ---------- Token ----------
export function getToken() { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } }
export function setToken(t) { try { localStorage.setItem(TOKEN_KEY, t.trim()); } catch { /* ohne Storage */ } }
export function clearToken() { try { localStorage.removeItem(TOKEN_KEY); } catch { /* egal */ } }

async function gh(path, { token = getToken(), method = 'GET', body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, data };
}

// -> {ok:true} oder {ok:false, msg}
export async function checkToken(token) {
  if (!token) return { ok: false, msg: 'Kein Token eingegeben.' };
  let r;
  try { r = await gh(`/repos/${REPO}`, { token }); } catch { return { ok: false, msg: 'GitHub nicht erreichbar – Internetverbindung prüfen.' }; }
  if (r.status === 401) return { ok: false, msg: 'Token ungültig oder abgelaufen.' };
  if (r.status === 404) return { ok: false, msg: `Token hat keinen Zugriff auf ${REPO} (beim Erstellen das Repo auswählen).` };
  if (!r.ok) return { ok: false, msg: `GitHub-Fehler ${r.status}: ${r.data.message || ''}` };
  if (!r.data.permissions?.push) return { ok: false, msg: 'Token darf nicht schreiben – Berechtigung „Contents: Read and write“ setzen.' };
  return { ok: true };
}

// ---------- Datei-Referenz merken (IndexedDB) ----------
const DB = 'werderspiele', STORE = 'handles';
function idb(mode, fn) {
  return new Promise((resolve) => {
    try {
      const open = indexedDB.open(DB, 1);
      open.onupgradeneeded = () => open.result.createObjectStore(STORE);
      open.onerror = () => resolve(null);
      open.onsuccess = () => {
        try {
          const tx = open.result.transaction(STORE, mode);
          const req = fn(tx.objectStore(STORE));
          tx.oncomplete = () => resolve(req?.result ?? null);
          tx.onerror = tx.onabort = () => resolve(null);
        } catch { resolve(null); } // z. B. Referenz nicht speicherbar
      };
    } catch { resolve(null); }
  });
}
const loadHandle = () => idb('readonly', (s) => s.get('excel'));
const saveHandle = (h) => idb('readwrite', (s) => s.put(h, 'excel'));
export const forgetFile = () => idb('readwrite', (s) => s.delete('excel'));
export const canRemember = () => typeof window.showOpenFilePicker === 'function';

function pickViaInput() {
  return new Promise((resolve) => {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    input.addEventListener('change', () => resolve(input.files[0] || null), { once: true });
    input.addEventListener('cancel', () => resolve(null), { once: true });
    input.click();
  });
}

// Gemerkte Datei verwenden (nach Erlaubnis), sonst auswählen lassen. -> File | null
export async function getFile({ forcePick = false } = {}) {
  if (!canRemember()) return pickViaInput();
  if (!forcePick) {
    const handle = await loadHandle();
    if (handle) {
      try {
        let perm = await handle.queryPermission({ mode: 'read' });
        if (perm !== 'granted') perm = await handle.requestPermission({ mode: 'read' });
        if (perm === 'granted') return await handle.getFile();
      } catch { /* Datei verschoben/gelöscht -> neu wählen */ }
    }
  }
  try {
    const [handle] = await window.showOpenFilePicker({
      id: 'werderspiele-excel', startIn: 'documents', multiple: false,
      types: [{ description: 'Excel-Datei', accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] } }],
    });
    await saveHandle(handle);
    return await handle.getFile();
  } catch (e) {
    if (e?.name === 'AbortError') return null;
    throw e;
  }
}

// ---------- Hochladen ----------
function toBase64(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// Git-Blob-SHA1 ("blob <len>\0" + Inhalt) – identisch mit der sha der GitHub-Contents-API
export async function gitBlobSha(buf) {
  const head = new TextEncoder().encode(`blob ${buf.byteLength}\0`);
  const all = new Uint8Array(head.length + buf.byteLength);
  all.set(head);
  all.set(new Uint8Array(buf), head.length);
  const hash = await crypto.subtle.digest('SHA-1', all);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function currentSha() {
  const r = await gh(`/repos/${REPO}/contents/${PATH}?ref=${BRANCH}`);
  if (r.status === 404) return null;
  if (r.status === 401) throw new Error('Token ungültig oder abgelaufen.');
  if (!r.ok) throw new Error(`GitHub-Fehler ${r.status}: ${r.data.message || ''}`);
  return r.data.sha;
}

// -> {status:'unchanged'} | {status:'uploaded', url}
export async function uploadExcel(buf, message) {
  const local = await gitBlobSha(buf);
  const content = toBase64(buf);
  for (let attempt = 0; attempt < 2; attempt++) {
    const sha = await currentSha();
    if (sha === local) return { status: 'unchanged' };
    const r = await gh(`/repos/${REPO}/contents/${PATH}`, {
      method: 'PUT',
      body: { message, content, branch: BRANCH, ...(sha ? { sha } : {}) },
    });
    if (r.ok) return { status: 'uploaded', url: r.data.commit?.html_url };
    if ((r.status === 409 || r.status === 422) && attempt === 0) continue; // inzwischen geändert -> sha neu holen
    if (r.status === 401) throw new Error('Token ungültig oder abgelaufen.');
    if (r.status === 403 || r.status === 404) throw new Error('Token darf nicht in das Repo schreiben.');
    throw new Error(`GitHub-Fehler ${r.status}: ${r.data.message || ''}`);
  }
  throw new Error('Datei wurde parallel geändert – bitte erneut versuchen.');
}
