// Character data management and Firebase persistence
// Dependencies: global _state, _projId, window._fb, window._db, _scheduleAutoSave(), _charRender()

export const CHAR_COLORS = [
  '#c98c2a', '#5a8a3e', '#3a6c8c', '#9c3d4a',
  '#6b4c8a', '#2a6a5a', '#c47a5a', '#8a8a3e',
  '#5a5a8a', '#8a3e5a', '#3e8a8a', '#6b6b6b',
];

export function charNewId() {
  return 'char_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
}

export function charGetAll() {
  if (typeof _state !== 'object' || _state == null) return [];
  if (!Array.isArray(_state.characters)) _state.characters = [];
  return _state.characters;
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
  if (typeof _scheduleAutoSave === 'function') _scheduleAutoSave();
  if (typeof _charRender === 'function') _charRender();
  charSaveToFirebase(c.id, c);
  return c;
}

export function charDelete(id) {
  if (!id) return;
  const list = charGetAll();
  const i = list.findIndex(c => c.id === id);
  if (i >= 0) {
    list.splice(i, 1);
    if (typeof _scheduleAutoSave === 'function') _scheduleAutoSave();
    if (typeof _charRender === 'function') _charRender();
    charSaveToFirebase(id, null);
  }
}

export async function charSaveToFirebase(charId, charData) {
  if (!charId || typeof _projId === 'undefined' || !window._fb || !window._db) return;
  try {
    const ref = window._fb.doc(window._db, 'folio_projects', _projId, 'characters', charId);
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
  if (typeof _projId === 'undefined' || !window._fb || !window._db) return;
  try {
    const { collection, getDocs } = window._fb;
    const colRef = collection(window._db, 'folio_projects', _projId, 'characters');
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

    if (typeof _state !== 'object' || _state == null) _state = {};
    if (!Array.isArray(_state.characters)) _state.characters = [];

    for (let i = 0; i < loaded.length; i++) {
      const idx = _state.characters.findIndex(c => c.id === loaded[i].id);
      if (idx >= 0) {
        _state.characters[idx] = loaded[i];
      } else {
        _state.characters.push(loaded[i]);
      }
    }

    if (typeof _charRender === 'function') _charRender();
  } catch (e) {
    console.warn('[char-firebase] load failed', e);
    if (typeof _state === 'object' && _state && Array.isArray(_state.characters)) {
      if (typeof _charRender === 'function') _charRender();
    }
  }
}

export async function charSaveAllToFirebase() {
  if (typeof _projId === 'undefined' || !window._fb || !window._db) return;
  const chars = charGetAll();
  for (let i = 0; i < chars.length; i++) {
    await charSaveToFirebase(chars[i].id, chars[i]);
  }
}

// Dialogue character assignments
let dialogueAssignments = {};

function textHashSimple(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h) + str.charCodeAt(i);
  return (h >>> 0).toString(36);
}

export function dialogueAssignCharacter(chapterId, dialogueText, characterId) {
  if (!dialogueAssignments[chapterId]) dialogueAssignments[chapterId] = {};
  const hash = textHashSimple(dialogueText.trim());
  if (characterId) {
    dialogueAssignments[chapterId][hash] = characterId;
  } else {
    delete dialogueAssignments[chapterId][hash];
  }
  dialogueSaveToFirebase();
}

export function dialogueGetCharacter(chapterId, dialogueText) {
  if (!dialogueAssignments[chapterId]) return null;
  const hash = textHashSimple(dialogueText.trim());
  return dialogueAssignments[chapterId][hash] || null;
}

export async function dialogueSaveToFirebase() {
  if (typeof _projId === 'undefined' || !window._fb || !window._db) return;
  try {
    const ref = window._fb.doc(window._db, 'folio_projects', _projId, 'metadata', 'dialogueAssignments');
    await window._fb.setDoc(ref, dialogueAssignments, { merge: true });
  } catch (e) {
    console.warn('[dialogue-firebase] save failed', e);
  }
}

export async function dialogueLoadFromFirebase() {
  if (typeof _projId === 'undefined' || !window._fb || !window._db) return;
  try {
    const ref = window._fb.doc(window._db, 'folio_projects', _projId, 'metadata', 'dialogueAssignments');
    const snap = await window._fb.getDoc(ref);
    if (snap.exists()) {
      dialogueAssignments = snap.data() || {};
    }
  } catch (e) {
    console.warn('[dialogue-firebase] load failed', e);
    dialogueAssignments = {};
  }
}

export function charVoiceLabel(c) {
  if (!c || !c.voiceId) return null;
  if (c.voiceProvider === 'google' && typeof _apGoogleVoices !== 'undefined' && Array.isArray(_apGoogleVoices)) {
    const v = _apGoogleVoices.find(x => x.id === c.voiceId || x.name === c.voiceId);
    if (v) return 'Google · ' + (v.label || v.name || v.id);
  }
  if (c.voiceProvider === 'elevenlabs' && typeof _apElVoices !== 'undefined' && Array.isArray(_apElVoices)) {
    const v = _apElVoices.find(x => x.id === c.voiceId);
    if (v) return 'ElevenLabs · ' + (v.label || v.name || v.id);
  }
  return (c.voiceProvider || 'voice') + ' · ' + c.voiceId;
}

// Export internal dialogue state for debugging
export function getDialogueAssignments() {
  return dialogueAssignments;
}

export function setDialogueAssignments(assignments) {
  dialogueAssignments = assignments;
}
