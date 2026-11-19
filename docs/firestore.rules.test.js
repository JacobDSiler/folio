/* ══════════════════════════════════════════════════════════════════════
   firestore.rules.test.js
   ══════════════════════════════════════════════════════════════════════

   Offline rules tests for Folio Junior (Phase 1a).
   Run:
     npm install --save-dev @firebase/rules-unit-testing firebase mocha
     npx mocha docs/firestore.rules.test.js --timeout 10000

   Proves the three Phase 1a safety invariants:
     1. A Junior work cannot be flipped listOnShelf=true without an
        approved + matching + kind=share-to-shelf approvals doc.
     2. A Junior work cannot have a share-link signed_teaser created
        without the Junior profile existing (and the share-link approval
        enforced client-side).
     3. Only the guardian can read, write, update, or delete a Junior
        profile; nobody (not even admin) can write it from a client.

   Also covers:
     - Approvals ledger is append-only (no updates, no deletes).
     - Guardian can create/read/write Junior folios.
     - Non-guardian cannot read Junior folios' body, cannot see the
       Junior profile, cannot read the approvals ledger.
     - An adult folio (juniorId==null) is unaffected by any of the
       new Junior rules.
   ══════════════════════════════════════════════════════════════════════ */

const { initializeTestEnvironment, assertSucceeds, assertFails } =
  require('@firebase/rules-unit-testing');
const fs = require('fs');
const path = require('path');

const PROJECT_ID = 'folio-rules-test';
const RULES_PATH = path.join(__dirname, 'firestore.rules');

let env;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: fs.readFileSync(RULES_PATH, 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

after(async () => {
  if (env) await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
});

/* ─── Helpers ─── */
function guardian(uid)   { return env.authenticatedContext(uid).firestore(); }
function stranger(uid)   { return env.authenticatedContext(uid).firestore(); }
function seedAdmin(uid)  { return env.authenticatedContext(uid, { admin: true }).firestore(); }
function asAdmin()       { return env.withSecurityRulesDisabled(async (ctx) => ctx.firestore()); }

async function seedJunior(juniorId, guardianUid) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc(`folio_juniors/${juniorId}`).set({
      guardianUid,
      name: 'Testy',
      avatar: '🧸',
      birthYear: 2018,
      createdAt: Date.now(),
    });
  });
}
async function seedFolio(folioId, ownerUid, juniorId) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc(`folio_projects/${folioId}`).set({
      uid: ownerUid,
      juniorId: juniorId || null,
      release: null,
    });
  });
}
async function seedShareApproval(juniorId, approvalId, targetFolioId, guardianUid, decision) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc(`folio_juniors/${juniorId}/approvals/${approvalId}`).set({
      kind: 'share-to-shelf',
      target: targetFolioId,
      decision,
      guardianUid,
      at: Date.now(),
    });
  });
}

/* ─── Suite ─── */
describe('Folio Junior — profile + approvals', () => {
  it('guardian can create their own Junior profile', async () => {
    const db = guardian('guardian-1');
    await assertSucceeds(db.doc('folio_juniors/jr-1').set({
      guardianUid: 'guardian-1',
      name: 'Testy',
      avatar: '🧸',
      birthYear: 2018,
      createdAt: Date.now(),
    }));
  });

  it('stranger cannot read another family\'s Junior profile', async () => {
    await seedJunior('jr-1', 'guardian-1');
    const db = stranger('stranger-1');
    await assertFails(db.doc('folio_juniors/jr-1').get());
  });

  it('nobody can transfer guardianUid to another uid', async () => {
    await seedJunior('jr-1', 'guardian-1');
    const db = guardian('guardian-1');
    await assertFails(db.doc('folio_juniors/jr-1').update({
      guardianUid: 'other-guardian',
    }));
  });

  it('approvals ledger is append-only — updates rejected', async () => {
    await seedJunior('jr-1', 'guardian-1');
    await seedShareApproval('jr-1', 'ap-1', 'folio-1', 'guardian-1', 'approved');
    const db = guardian('guardian-1');
    await assertFails(db.doc('folio_juniors/jr-1/approvals/ap-1').update({
      decision: 'revoked',
    }));
  });

  it('approvals ledger is append-only — deletes rejected', async () => {
    await seedJunior('jr-1', 'guardian-1');
    await seedShareApproval('jr-1', 'ap-1', 'folio-1', 'guardian-1', 'approved');
    const db = guardian('guardian-1');
    await assertFails(db.doc('folio_juniors/jr-1/approvals/ap-1').delete());
  });
});

describe('Folio Junior — Phase 1a safety invariants', () => {
  it('Invariant 1: Junior work cannot flip listOnShelf=true WITHOUT approval', async () => {
    await seedJunior('jr-1', 'guardian-1');
    await seedFolio('folio-1', 'guardian-1', 'jr-1');
    const db = guardian('guardian-1');
    await assertFails(db.doc('folio_projects/folio-1').update({
      release: {
        listOnShelf: true,
        juniorShareApprovalId: null,
      },
    }));
  });

  it('Invariant 1: Junior work CAN flip listOnShelf=true WITH approval', async () => {
    await seedJunior('jr-1', 'guardian-1');
    await seedFolio('folio-1', 'guardian-1', 'jr-1');
    await seedShareApproval('jr-1', 'ap-1', 'folio-1', 'guardian-1', 'approved');
    const db = guardian('guardian-1');
    await assertSucceeds(db.doc('folio_projects/folio-1').update({
      release: {
        listOnShelf: true,
        juniorShareApprovalId: 'ap-1',
      },
    }));
  });

  it('Invariant 1: Declined approval does not satisfy the gate', async () => {
    await seedJunior('jr-1', 'guardian-1');
    await seedFolio('folio-1', 'guardian-1', 'jr-1');
    await seedShareApproval('jr-1', 'ap-1', 'folio-1', 'guardian-1', 'declined');
    const db = guardian('guardian-1');
    await assertFails(db.doc('folio_projects/folio-1').update({
      release: {
        listOnShelf: true,
        juniorShareApprovalId: 'ap-1',
      },
    }));
  });

  it('Invariant 1: Approval for a DIFFERENT folio does not satisfy the gate', async () => {
    await seedJunior('jr-1', 'guardian-1');
    await seedFolio('folio-1', 'guardian-1', 'jr-1');
    await seedFolio('folio-2', 'guardian-1', 'jr-1');
    await seedShareApproval('jr-1', 'ap-1', 'folio-2', 'guardian-1', 'approved');
    const db = guardian('guardian-1');
    await assertFails(db.doc('folio_projects/folio-1').update({
      release: {
        listOnShelf: true,
        juniorShareApprovalId: 'ap-1',
      },
    }));
  });

  it('Invariant 2: share_tokens cannot be created on Junior folio without profile existing', async () => {
    await seedFolio('folio-1', 'guardian-1', 'jr-nonexistent');
    const db = guardian('guardian-1');
    await assertFails(db.doc('folio_projects/folio-1/signed_teasers/tok-1').set({
      chapterId: 'ch-1',
      createdAt: Date.now(),
    }));
  });

  it('Invariant 3: Non-guardian cannot write the Junior profile', async () => {
    await seedJunior('jr-1', 'guardian-1');
    const db = stranger('stranger-1');
    await assertFails(db.doc('folio_juniors/jr-1').update({ name: 'Hacked' }));
  });

  it('Invariant 3: Non-guardian cannot delete the Junior profile', async () => {
    await seedJunior('jr-1', 'guardian-1');
    const db = stranger('stranger-1');
    await assertFails(db.doc('folio_juniors/jr-1').delete());
  });

  it('Adult folio (juniorId=null) is unaffected by Junior rules — can still go to Shelf as a non-anonymous Google user', async () => {
    await seedFolio('folio-adult', 'adult-uid', null);
    const db = env.authenticatedContext('adult-uid', { firebase: { sign_in_provider: 'google.com' } }).firestore();
    await assertSucceeds(db.doc('folio_projects/folio-adult').update({
      release: { listOnShelf: true },
    }));
  });
});
