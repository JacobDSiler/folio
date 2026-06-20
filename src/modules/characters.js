// Character data management and Firebase persistence.
//
// Runs inside <script type="module">. ES modules have their OWN scope —
// they CANNOT see top-level `let _projId` / `let _state` from the classic
// <script> below in app.html. We therefore reference both as window
// properties (window._projId, window._state) so the module sees the
// classic script's live values. Without this every Firebase save/load
// silently no-ops on the `typeof _projId === 'undefined'` guard.
// Other dependencies (window._fb, window._db, window._scheduleAutoSave,
// window._charRender, window._apGoogleVoices, window._apElVoices) are
// already on window for the same reason.

export const CHAR_COLORS = [
  '#c98c2a', '#5a8a3e', '#3a6c8c', '#9c3d4a',
  '#6b4c8a', '#2a6a5a', '#c47a5a', '#8a8a3e',
  '#5a5a8a', '#8a3e5a', '#3e8a8a', '#6b6b6b',
];

export function charNewId() {
  return 'char_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
}

// Tiny helper — returns window._state, lazily initialising .characters
// so callers always see a real array even on a fresh page.
function _ensureStateChars() {
  if (typeof window._state !== 'object' || window._state == null) window._state = {};
  if (!Array.isArray(window._state.characters)) window._state.characters = [];
  return window._state.characters;
}

export function charGetAll() {
  return _ensureStateChars();
}

export function charGetById(id) {
  const list = charGetAll();
  return list.find(c => c.id === id) || null;
}

export function charAdd(rec) {
  if (!rec || !rec.name) return null;
  const list = charGetAll();
  const c = {
    id: rec.id || charNewId(),
    name: String(rec.name).trim(),
    voiceId: String(rec.voiceId || ''),
    voiceProvider: String(rec.voiceProvider || ''),
    description: String(rec.description || '').trim(),
    aliases: Array.isArray(rec.aliases)
      ? rec.aliases.map(a => String(a).trim().toLowerCase()).filter(Boolean)
      : [],
    color: String(rec.color || CHAR_COLORS[list.length % CHAR_COLORS.length]),
    createdAt: rec.createdAt || Date.now(),
    updatedAt: Date.now(),
  };
  // Replace if exists by id, otherwise append
  const i = list.findIndex(x => x.id === c.id);
  if (i >= 0) list[i] = c; else list.push(c);
  if (typeof window._scheduleAutoSave === 'function') window._scheduleAutoSave();
  if (typeof window._charRender === 'function') window._charRender();
  // Re-render preview so the dialogue-color underline picks up the new
  // (or changed) character color immediately, without waiting for the
  // next render trigger.
  if (typeof window.renderPreview === 'function') window.renderPreview();
  charSaveToFirebase(c.id, c);
  return c;
}

export function charDelete(id) {
  if (!id) return;
  const list = charGetAll();
  const i = list.findIndex(c => c.id === id);
  if (i >= 0) {
    list.splice(i, 1);
    if (typeof window._scheduleAutoSave === 'function') window._scheduleAutoSave();
    if (typeof window._charRender === 'function') window._charRender();
    if (typeof window.renderPreview === 'function') window.renderPreview();
    charSaveToFirebase(id, null);
  }
}

export async function charSaveToFirebase(charId, charData) {
  if (!charId || !window._projId || !window._fb || !window._db) return;
  try {
    const ref = window._fb.doc(window._db, 'folio_projects', window._projId, 'characters', charId);
    if (charData === null) {
      await window._fb.deleteDoc(ref);
    } else {
      await window._fb.setDoc(ref, charData);
    }
  } catch (e) {
    console.warn('[char-firebase] save failed', e);
  }
}

export async function charLoadFromFirebase() {
  if (!window._projId || !window._fb || !window._db) return;
  try {
    const { collection, getDocs } = window._fb;
    const colRef = collection(window._db, 'folio_projects', window._projId, 'characters');
    const snap = await getDocs(colRef);
    const loaded = [];
    snap.forEach(doc => {
      const data = doc.data();
      loaded.push({
        id: doc.id,
        ...data,
        aliases: Array.isArray(data.aliases) ? data.aliases : [],
      });
    });

    const list = _ensureStateChars();
    for (let i = 0; i < loaded.length; i++) {
      const idx = list.findIndex(c => c.id === loaded[i].id);
      if (idx >= 0) list[idx] = loaded[i];
      else            list.push(loaded[i]);
    }

    if (typeof window._charRender === 'function') window._charRender();
    if (typeof window.renderPreview === 'function') window.renderPreview();
  } catch (e) {
    console.warn('[char-firebase] load failed', e);
    if (typeof window._charRender === 'function') window._charRender();
  }
}

export async function charSaveAllToFirebase() {
  if (!window._projId || !window._fb || !window._db) return;
  const chars = charGetAll();
  for (let i = 0; i < chars.length; i++) {
    await charSaveToFirebase(chars[i].id, chars[i]);
  }
}

// Dialogue character assignments.
// Local in-memory map; mirrored to Firestore at
//   folio_projects/<id>/metadata/dialogueAssignments  (single doc, merge).
let dialogueAssignments = {};

function textHashSimple(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h) + str.charCodeAt(i);
  return (h >>> 0).toString(36);
}

export function dialogueAssignCharacter(chapterId, dialogueText, characterId) {
  if (!dialogueAssignments[chapterId]) dialogueAssignments[chapterId] = {};
  const hash = textHashSimple(String(dialogueText || '').trim());
  if (characterId) {
    dialogueAssignments[chapterId][hash] = characterId;
  } else {
    delete dialogueAssignments[chapterId][hash];
  }
  // Persist + re-render. Saving is async + best-effort; the highlight
  // re-render is synchronous so users see immediate feedback.
  dialogueSaveToFirebase();
  if (typeof window.renderPreview === 'function') window.renderPreview();
}

export function dialogueGetCharacter(chapterId, dialogueText) {
  if (!dialogueAssignments[chapterId]) return null;
  const hash = textHashSimple(String(dialogueText || '').trim());
  return dialogueAssignments[chapterId][hash] || null;
}

export async function dialogueSaveToFirebase() {
  if (!window._projId || !window._fb || !window._db) return;
  try {
    const ref = window._fb.doc(window._db, 'folio_projects', window._projId, 'metadata', 'dialogueAssignments');
    await window._fb.setDoc(ref, dialogueAssignments, { merge: true });
  } catch (e) {
    console.warn('[dialogue-firebase] save failed', e);
  }
}

export async function dialogueLoadFromFirebase() {
  if (!window._projId || !window._fb || !window._db) return;
  try {
    const ref = window._fb.doc(window._db, 'folio_projects', window._projId, 'metadata', 'dialogueAssignments');
    const snap = await window._fb.getDoc(ref);
    if (snap.exists()) {
      dialogueAssignments = snap.data() || {};
    }
    // Re-render after load so any saved assignments paint immediately.
    if (typeof window.renderPreview === 'function') window.renderPreview();
  } catch (e) {
    console.warn('[dialogue-firebase] load failed', e);
    dialogueAssignments = {};
  }
}

export function charVoiceLabel(c) {
  if (!c || !c.voiceId) return null;
  if (c.voiceProvider === 'google' && Array.isArray(window._apGoogleVoices)) {
    const v = window._apGoogleVoices.find(x => x.id === c.voiceId || x.name === c.voiceId);
    if (v) return 'Google · ' + (v.label || v.name || v.id);
  }
  if (c.voiceProvider === 'elevenlabs' && Array.isArray(window._apElVoices)) {
    const v = window._apElVoices.find(x => x.id === c.voiceId);
    if (v) return 'ElevenLabs · ' + (v.label || v.name || v.id);
  }
  return (c.voiceProvider || 'voice') + ' · ' + c.voiceId;
}

// Export internal dialogue state for debugging / cloud-sync.
export function getDialogueAssignments() {
  return dialogueAssignments;
}

export function setDialogueAssignments(assignments) {
  dialogueAssignments = (assignments && typeof assignments === 'object') ? assignments : {};
}
