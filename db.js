// MongoDB connection helper (optional in-memory fallback if enabled) + password helpers
const { MongoClient, ObjectId } = require('mongodb');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const uri = process.env.MONGO_URI || 'mongodb://localhost:27017';
const DB_NAME = process.env.MONGO_DB || 'crossworddb';
const allowMemory = /^true$/i.test(process.env.ALLOW_MEMORY_FALLBACK || '');

let client;
let db;
let connectingPromise;
let memoryMode = false;
const memoryUsers = [];
const memoryPasswordResets = [];
const memoryHistoryRequests = [];
const memoryPuzzleRequests = [];

function makeMemId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// Internal: hash a plain password
function hashPassword(plain) {
  const saltRounds = 10; // adjust if needed for security/performance
  return bcrypt.hashSync(plain, saltRounds);
}

async function connect() {
  if (db) return db;
  if (connectingPromise) return connectingPromise;
  client = new MongoClient(uri, { serverSelectionTimeoutMS: 3000, connectTimeoutMS: 3000 });
  connectingPromise = client.connect()
    .then(() => {
      db = client.db(DB_NAME);
      console.log(`[DB] Connected to MongoDB at ${uri} (db=${DB_NAME})`);
      return db;
    })
    .catch(err => {
      if (allowMemory) {
        console.warn('[DB] MongoDB unavailable. ALLOW_MEMORY_FALLBACK enabled -> using in-memory user store. Reason:', err.message);
        memoryMode = true;
        return null;
      } else {
        console.error('[DB] FATAL: Unable to connect to MongoDB:', err.message);
        throw err;
      }
    });
  return connectingPromise;
}

async function getUsersCollection() {
  const database = await connect();
  if (memoryMode) {
    return {
      findOne: async (query) => memoryUsers.find(u => u.username === query.username) || null,
      insertOne: async (doc) => { memoryUsers.push(doc); return { insertedId: memoryUsers.length }; }
    };
  }
  return database.collection('users');
}

async function getPasswordResetsCollection() {
  const database = await connect();
  if (memoryMode) {
    return {
      insertOne: async (doc) => { memoryPasswordResets.push(doc); return { insertedId: doc._id }; },
      find: async (query = {}) => {
        // naive filter for resolved state
        let arr = memoryPasswordResets.slice();
        if (query.resolvedAt === null) arr = arr.filter(r => !r.resolvedAt);
        return arr;
      },
      findOneAndUpdate: async (filter, update) => {
        const id = filter._id;
        const idx = memoryPasswordResets.findIndex(r => r._id === id);
        if (idx === -1) return { value: null };
        const set = update.$set || {};
        memoryPasswordResets[idx] = { ...memoryPasswordResets[idx], ...set };
        return { value: memoryPasswordResets[idx] };
      },
      deleteOne: async (filter) => {
        const id = filter._id;
        const idx = memoryPasswordResets.findIndex(r => r._id === id);
        if (idx === -1) return { deletedCount: 0 };
        memoryPasswordResets.splice(idx, 1);
        return { deletedCount: 1 };
      }
    };
  }
  return database.collection('password_resets');
}

async function getHistoryRequestsCollection() {
  const database = await connect();
  if (memoryMode) {
    return {
      insertOne: async (doc) => { memoryHistoryRequests.push(doc); return { insertedId: doc._id }; },
      find: async (query = {}) => {
        let arr = memoryHistoryRequests.slice();
        if (query.resolvedAt === null) arr = arr.filter(r => !r.resolvedAt);
        return arr;
      },
      findOneAndUpdate: async (filter, update) => {
        const id = filter._id;
        const idx = memoryHistoryRequests.findIndex(r => r._id === id);
        if (idx === -1) return { value: null };
        const set = update.$set || {};
        memoryHistoryRequests[idx] = { ...memoryHistoryRequests[idx], ...set };
        return { value: memoryHistoryRequests[idx] };
      },
      deleteOne: async (filter) => {
        const id = filter._id;
        const idx = memoryHistoryRequests.findIndex(r => r._id === id);
        if (idx === -1) return { deletedCount: 0 };
        memoryHistoryRequests.splice(idx, 1);
        return { deletedCount: 1 };
      }
    };
  }
  return database.collection('history_requests');
}

async function getPuzzleRequestsCollection() {
  const database = await connect();
  if (memoryMode) {
    return {
      insertOne: async (doc) => { memoryPuzzleRequests.push(doc); return { insertedId: doc._id }; },
      find: async (query = {}) => {
        let arr = memoryPuzzleRequests.slice();
        if (query.resolvedAt === null) arr = arr.filter(r => !r.resolvedAt);
        return arr;
      },
      findOneAndUpdate: async (filter, update) => {
        const id = filter._id;
        const idx = memoryPuzzleRequests.findIndex(r => r._id === id);
        if (idx === -1) return { value: null };
        const set = update.$set || {};
        memoryPuzzleRequests[idx] = { ...memoryPuzzleRequests[idx], ...set };
        return { value: memoryPuzzleRequests[idx] };
      },
      deleteOne: async (filter) => {
        const id = filter._id;
        const idx = memoryPuzzleRequests.findIndex(r => r._id === id);
        if (idx === -1) return { deletedCount: 0 };
        memoryPuzzleRequests.splice(idx, 1);
        return { deletedCount: 1 };
      }
    };
  }
  return database.collection('puzzle_requests');
}

async function findUser(username) {
  const users = await getUsersCollection();
  return users.findOne({ username: username.toLowerCase() });
}

async function addUser(username) {
  const users = await getUsersCollection();
  username = username.toLowerCase();
  const existing = await users.findOne({ username });
  if (existing) return existing;
  const result = await users.insertOne({ username, createdAt: new Date() });
  return { _id: result.insertedId, username, createdAt: new Date() };
}

// Create (or update missing hash) a user with a password. Returns the user document (after ensuring password).
async function addUserWithPassword(username, plainPassword, email) {
  username = username.toLowerCase();
  const safeEmail = typeof email === 'string' ? email.trim().toLowerCase() : null;
  const users = await getUsersCollection();
  let user = await users.findOne({ username });
  const now = new Date();
  const passwordHash = hashPassword(plainPassword);
  if (!user) {
    // insert new
    if (memoryMode) {
      user = { username, email: safeEmail, passwordHash, createdAt: now, passwordUpdatedAt: now, score: 0, completedPuzzles: [] };
      memoryUsers.push(user);
      return user;
    }
    const result = await users.insertOne({ username, email: safeEmail, passwordHash, createdAt: now, passwordUpdatedAt: now, score: 0, completedPuzzles: [], completedHistory: [], failedPuzzles: [], failedHistory: [], currentPuzzleId: null, currentPuzzleAnswers: null, currentPuzzleUpdatedAt: null, currentPuzzleWrongAttempts: 0, currentPuzzleElapsedTime: 0 });
    return { _id: result.insertedId, username, email: safeEmail, passwordHash, createdAt: now, passwordUpdatedAt: now, score: 0, completedPuzzles: [], completedHistory: [], failedPuzzles: [], failedHistory: [], currentPuzzleId: null, currentPuzzleAnswers: null, currentPuzzleUpdatedAt: null, currentPuzzleWrongAttempts: 0, currentPuzzleElapsedTime: 0 };
  }
  // user exists; if it lacks passwordHash, set it (migration scenario)
  if (!user.passwordHash) {
    if (memoryMode) {
      user.passwordHash = passwordHash;
      user.passwordUpdatedAt = now;
      return user;
    }
    await users.updateOne({ _id: user._id }, { $set: { passwordHash, passwordUpdatedAt: now } });
    user.passwordHash = passwordHash;
    user.passwordUpdatedAt = now;
  }
  // Migration: ensure baseline fields exist (including email)
  if (user.score == null || !Array.isArray(user.completedPuzzles) || (user.currentPuzzleId === undefined) || (user.currentPuzzleWrongAttempts === undefined) || !Array.isArray(user.failedPuzzles) || !Array.isArray(user.completedHistory) || !Array.isArray(user.failedHistory) || (user.currentPuzzleElapsedTime === undefined) || (user.email === undefined)) {
    if (memoryMode) {
      if (user.score == null) user.score = 0;
      if (!Array.isArray(user.completedPuzzles)) user.completedPuzzles = [];
      if (user.currentPuzzleId === undefined) { user.currentPuzzleId = null; user.currentPuzzleAnswers = null; user.currentPuzzleUpdatedAt = null; }
      if (user.currentPuzzleWrongAttempts === undefined) { user.currentPuzzleWrongAttempts = 0; }
      if (!Array.isArray(user.completedHistory)) user.completedHistory = [];
      if (!Array.isArray(user.failedPuzzles)) user.failedPuzzles = [];
      if (!Array.isArray(user.failedHistory)) user.failedHistory = [];
      if (user.currentPuzzleElapsedTime === undefined) { user.currentPuzzleElapsedTime = 0; }
      if (user.email === undefined) { user.email = safeEmail || null; }
    } else {
      const setObj = {};
      if (user.score == null) { setObj.score = 0; user.score = 0; }
      if (!Array.isArray(user.completedPuzzles)) { setObj.completedPuzzles = []; user.completedPuzzles = []; }
      if (user.currentPuzzleId === undefined) { setObj.currentPuzzleId = null; setObj.currentPuzzleAnswers = null; setObj.currentPuzzleUpdatedAt = null; user.currentPuzzleId = null; user.currentPuzzleAnswers = null; user.currentPuzzleUpdatedAt = null; }
      if (user.currentPuzzleWrongAttempts === undefined) { setObj.currentPuzzleWrongAttempts = 0; user.currentPuzzleWrongAttempts = 0; }
      if (!Array.isArray(user.completedHistory)) { setObj.completedHistory = []; user.completedHistory = []; }
      if (!Array.isArray(user.failedPuzzles)) { setObj.failedPuzzles = []; user.failedPuzzles = []; }
      if (!Array.isArray(user.failedHistory)) { setObj.failedHistory = []; user.failedHistory = []; }
      if (user.currentPuzzleElapsedTime === undefined) { setObj.currentPuzzleElapsedTime = 0; user.currentPuzzleElapsedTime = 0; }
      if (user.email === undefined && safeEmail) { setObj.email = safeEmail; user.email = safeEmail; }
      if (Object.keys(setObj).length) await users.updateOne({ _id: user._id }, { $set: setObj });
    }
  }
  return user;
}

async function findUserByEmail(email) {
  const users = await getUsersCollection();
  return users.findOne({ email: String(email).toLowerCase() });
}

async function verifyUserPassword(username, plainPassword) {
  const user = await findUser(username.toLowerCase());
  if (!user || !user.passwordHash) return false; // treat missing hash as invalid
  try {
    return await bcrypt.compare(plainPassword, user.passwordHash);
  } catch (_) {
    return false;
  }
}

function isMemoryMode() { return memoryMode; }

// Award 1 point if puzzle not previously completed by this user
async function awardPointIfFirst(username, puzzleId, elapsedTime) {
  username = username.toLowerCase();
  if (memoryMode) {
    const user = memoryUsers.find(u => u.username === username);
    if (!user) return { updated: false, score: 0 };
    if (!user.completedPuzzles) user.completedPuzzles = [];
    if (user.completedPuzzles.includes(puzzleId)) return { updated: false, score: user.score || 0 };
    user.completedPuzzles.push(puzzleId);
    user.score = (user.score || 0) + 1;
    // memory history
    if (!user.completedHistory) user.completedHistory = [];
    user.completedHistory.push({ puzzleId, completedAt: new Date(), elapsedTime: elapsedTime || 0 });
    return { updated: true, score: user.score };
  }
  const users = await getUsersCollection();
  const res = await users.findOneAndUpdate(
    { username, completedPuzzles: { $ne: puzzleId } },
    { 
      $addToSet: { completedPuzzles: puzzleId },
      $inc: { score: 1 },
      $push: { completedHistory: { puzzleId, completedAt: new Date(), elapsedTime: elapsedTime || 0 } }
    },
    { returnDocument: 'after', projection: { score: 1 } }
  );
  if (!res.value) {
    const existing = await users.findOne({ username }, { projection: { score: 1 } });
    return { updated: false, score: existing?.score || 0 };
  }
  return { updated: true, score: res.value.score || 0 };
}

// Record a password reset request for admin attention
async function addPasswordResetRequest({ username, email, userAgent, ip }) {
  const resets = await getPasswordResetsCollection();
  const doc = {
    _id: memoryMode ? makeMemId() : undefined,
    username: (username || '').toLowerCase(),
    email: (email || '').trim(),
    userAgent: userAgent || null,
    ip: ip || null,
    createdAt: new Date(),
    resolvedAt: null,
    resolvedBy: null
  };
  if (memoryMode) {
    await resets.insertOne(doc);
    return { ok: true, id: doc._id };
  }
  const result = await resets.insertOne({
    username: doc.username,
    email: doc.email,
    userAgent: doc.userAgent,
    ip: doc.ip,
    createdAt: doc.createdAt,
    resolvedAt: doc.resolvedAt,
    resolvedBy: doc.resolvedBy
  });
  return { ok: true, id: result.insertedId.toString() };
}

// Create a password reset token record (hashed) with expiry
async function createPasswordResetToken(username, email, tokenHash, expiresAt) {
  const coll = await getPasswordResetsCollection();
  const doc = {
    _id: memoryMode ? makeMemId() : undefined,
    username: (username || '').toLowerCase(),
    email: (email || '').trim(),
    tokenHash: String(tokenHash),
    expiresAt: expiresAt || new Date(Date.now() + 15 * 60 * 1000),
    consumedAt: null,
    createdAt: new Date(),
    type: 'link-reset'
  };
  if (memoryMode) {
    memoryPasswordResets.push(doc);
    return { ok: true, id: doc._id };
  }
  const result = await coll.insertOne(doc);
  return { ok: true, id: result.insertedId.toString() };
}

async function findValidResetToken(tokenHash) {
  const coll = await getPasswordResetsCollection();
  if (memoryMode) {
    const now = new Date();
    return memoryPasswordResets.find(r => r.tokenHash === tokenHash && !r.consumedAt && r.expiresAt > now) || null;
  }
  return coll.findOne({ tokenHash, consumedAt: null, expiresAt: { $gt: new Date() } });
}

async function consumeResetToken(tokenHash) {
  const coll = await getPasswordResetsCollection();
  if (memoryMode) {
    const idx = memoryPasswordResets.findIndex(r => r.tokenHash === tokenHash && !r.consumedAt);
    if (idx === -1) return { ok: false };
    memoryPasswordResets[idx].consumedAt = new Date();
    return { ok: true };
  }
  const res = await coll.findOneAndUpdate(
    { tokenHash, consumedAt: null },
    { $set: { consumedAt: new Date() } },
    { returnDocument: 'after' }
  );
  return { ok: !!res.value };
}

async function updateUserPassword(username, newPlainPassword) {
  username = username.toLowerCase();
  const newHash = hashPassword(newPlainPassword);
  if (memoryMode) {
    const u = memoryUsers.find(x => x.username === username);
    if (!u) return { ok: false };
    u.passwordHash = newHash;
    u.passwordUpdatedAt = new Date();
    return { ok: true };
  }
  const users = await getUsersCollection();
  const res = await users.updateOne({ username }, { $set: { passwordHash: newHash, passwordUpdatedAt: new Date() } });
  return { ok: res.matchedCount === 1 };
}

async function listPasswordResetRequests(showResolved = true) {
  const coll = await getPasswordResetsCollection();
  if (memoryMode) {
    const all = await coll.find(showResolved ? {} : { resolvedAt: null });
    // sort latest first
    return all.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }
  const query = showResolved ? {} : { resolvedAt: null };
  const docs = await (await (await connect()).collection('password_resets'))
    .find(query)
    .sort({ createdAt: -1 })
    .toArray();
  return docs;
}

async function resolvePasswordResetRequest(id, resolvedBy) {
  const coll = await getPasswordResetsCollection();
  if (memoryMode) {
    const res = await coll.findOneAndUpdate({ _id: id }, { $set: { resolvedAt: new Date(), resolvedBy } });
    return { ok: !!res.value };
  }
  const _id = typeof id === 'string' ? new ObjectId(id) : id;
  const res = await coll.findOneAndUpdate({ _id }, { $set: { resolvedAt: new Date(), resolvedBy } }, { returnDocument: 'after' });
  return { ok: !!res.value };
}

async function deletePasswordResetRequest(id) {
  const coll = await getPasswordResetsCollection();
  if (memoryMode) {
    const r = await coll.deleteOne({ _id: id });
    return { ok: r.deletedCount === 1 };
  }
  const _id = typeof id === 'string' ? new ObjectId(id) : id;
  const r = await coll.deleteOne({ _id });
  return { ok: r.deletedCount === 1 };
}

// User history request management
async function addHistoryRequest({ username, reason, userAgent, ip }) {
  const coll = await getHistoryRequestsCollection();
  const doc = {
    _id: memoryMode ? makeMemId() : undefined,
    username: (username || '').toLowerCase(),
    reason: (reason || '').trim(),
    userAgent: userAgent || null,
    ip: ip || null,
    createdAt: new Date(),
    resolvedAt: null,
    resolvedBy: null
  };
  if (memoryMode) {
    await coll.insertOne(doc);
    return { ok: true, id: doc._id };
  }
  const result = await coll.insertOne({
    username: doc.username,
    reason: doc.reason,
    userAgent: doc.userAgent,
    ip: doc.ip,
    createdAt: doc.createdAt,
    resolvedAt: doc.resolvedAt,
    resolvedBy: doc.resolvedBy
  });
  return { ok: true, id: result.insertedId.toString() };
}

async function listHistoryRequests(showResolved = true) {
  const coll = await getHistoryRequestsCollection();
  if (memoryMode) {
    const all = await coll.find(showResolved ? {} : { resolvedAt: null });
    return all.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }
  const query = showResolved ? {} : { resolvedAt: null };
  const docs = await (await (await connect()).collection('history_requests'))
    .find(query)
    .sort({ createdAt: -1 })
    .toArray();
  return docs;
}

async function resolveHistoryRequest(id, resolvedBy) {
  const coll = await getHistoryRequestsCollection();
  if (memoryMode) {
    const res = await coll.findOneAndUpdate({ _id: id }, { $set: { resolvedAt: new Date(), resolvedBy } });
    return { ok: !!res.value };
  }
  const _id = typeof id === 'string' ? new ObjectId(id) : id;
  const res = await coll.findOneAndUpdate({ _id }, { $set: { resolvedAt: new Date(), resolvedBy } }, { returnDocument: 'after' });
  return { ok: !!res.value };
}

async function deleteHistoryRequest(id) {
  const coll = await getHistoryRequestsCollection();
  if (memoryMode) {
    const r = await coll.deleteOne({ _id: id });
    return { ok: r.deletedCount === 1 };
  }
  const _id = typeof id === 'string' ? new ObjectId(id) : id;
  const r = await coll.deleteOne({ _id });
  return { ok: r.deletedCount === 1 };
}

// Puzzle retrieval request management
async function addPuzzleRequest({ username, note, userAgent, ip }) {
  const coll = await getPuzzleRequestsCollection();
  const doc = {
    _id: memoryMode ? makeMemId() : undefined,
    username: (username || '').toLowerCase(),
    note: (note || '').trim(),
    userAgent: userAgent || null,
    ip: ip || null,
    createdAt: new Date(),
    resolvedAt: null,
    resolvedBy: null
  };
  if (memoryMode) {
    await coll.insertOne(doc);
    return { ok: true, id: doc._id };
  }
  const result = await coll.insertOne({
    username: doc.username,
    note: doc.note,
    userAgent: doc.userAgent,
    ip: doc.ip,
    createdAt: doc.createdAt,
    resolvedAt: doc.resolvedAt,
    resolvedBy: doc.resolvedBy
  });
  return { ok: true, id: result.insertedId.toString() };
}

async function listPuzzleRequests(showResolved = true) {
  const coll = await getPuzzleRequestsCollection();
  if (memoryMode) {
    const all = await coll.find(showResolved ? {} : { resolvedAt: null });
    return all.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }
  const query = showResolved ? {} : { resolvedAt: null };
  const docs = await (await (await connect()).collection('puzzle_requests'))
    .find(query)
    .sort({ createdAt: -1 })
    .toArray();
  return docs;
}

async function resolvePuzzleRequest(id, resolvedBy) {
  const coll = await getPuzzleRequestsCollection();
  if (memoryMode) {
    const res = await coll.findOneAndUpdate({ _id: id }, { $set: { resolvedAt: new Date(), resolvedBy } });
    return { ok: !!res.value };
  }
  const _id = typeof id === 'string' ? new ObjectId(id) : id;
  const res = await coll.findOneAndUpdate({ _id }, { $set: { resolvedAt: new Date(), resolvedBy } }, { returnDocument: 'after' });
  return { ok: !!res.value };
}

async function deletePuzzleRequest(id) {
  const coll = await getPuzzleRequestsCollection();
  if (memoryMode) {
    const r = await coll.deleteOne({ _id: id });
    return { ok: r.deletedCount === 1 };
  }
  const _id = typeof id === 'string' ? new ObjectId(id) : id;
  const r = await coll.deleteOne({ _id });
  return { ok: r.deletedCount === 1 };
}

// Current puzzle state helpers
async function setCurrentPuzzle(username, puzzleId) {
  username = username.toLowerCase();
  if (memoryMode) {
    let user = memoryUsers.find(u => u.username === username);
    if (!user) return { ok: false };
    user.currentPuzzleId = puzzleId;
    user.currentPuzzleAnswers = null;
    user.currentPuzzleUpdatedAt = new Date();
    user.currentPuzzleWrongAttempts = 0;
    user.currentPuzzleElapsedTime = 0;
    return { ok: true };
  }
  const users = await getUsersCollection();
  await users.updateOne({ username }, { $set: { currentPuzzleId: puzzleId, currentPuzzleAnswers: null, currentPuzzleUpdatedAt: new Date(), currentPuzzleWrongAttempts: 0, currentPuzzleElapsedTime: 0 } });
  return { ok: true };
}

async function updateCurrentPuzzleAnswers(username, puzzleId, answers) {
  username = username.toLowerCase();
  // Normalize to a flat string of length 100 (10x10) with '-' for blanks
  let answersString = '';
  if (Array.isArray(answers)) {
    answersString = answers.join('');
  } else if (typeof answers === 'string') {
    answersString = answers;
  } else {
    answersString = '';
  }
  if (memoryMode) {
    let user = memoryUsers.find(u => u.username === username);
    if (!user || user.currentPuzzleId !== puzzleId) return { ok: false };
    user.currentPuzzleAnswers = answersString;
    user.currentPuzzleUpdatedAt = new Date();
    return { ok: true };
  }
  const users = await getUsersCollection();
  const res = await users.updateOne({ username, currentPuzzleId: puzzleId }, { $set: { currentPuzzleAnswers: answersString, currentPuzzleUpdatedAt: new Date() } });
  return { ok: res.matchedCount === 1 };
}

async function updateCurrentPuzzleElapsedTime(username, elapsedTime) {
  username = username.toLowerCase();
  if (memoryMode) {
    let user = memoryUsers.find(u => u.username === username);
    if (!user) return { ok: false };
    user.currentPuzzleElapsedTime = elapsedTime;
    return { ok: true };
  }
  const users = await getUsersCollection();
  const res = await users.updateOne({ username }, { $set: { currentPuzzleElapsedTime: elapsedTime } });
  return { ok: res.matchedCount === 1 };
}

async function getCurrentPuzzleState(username) {
  const user = await findUser(username.toLowerCase());
  if (!user) return null;
  return { puzzleId: user.currentPuzzleId || null, answers: user.currentPuzzleAnswers || null, updatedAt: user.currentPuzzleUpdatedAt || null, wrongAttempts: user.currentPuzzleWrongAttempts || 0, elapsedTime: user.currentPuzzleElapsedTime || 0 };
}

async function clearCurrentPuzzle(username, puzzleId) {
  username = username.toLowerCase();
  if (memoryMode) {
    let user = memoryUsers.find(u => u.username === username);
    if (!user) return { ok: false };
    if (puzzleId && user.currentPuzzleId !== puzzleId) return { ok: false };
    user.currentPuzzleId = null;
    user.currentPuzzleAnswers = null;
    user.currentPuzzleUpdatedAt = new Date();
    user.currentPuzzleWrongAttempts = 0;
    user.currentPuzzleElapsedTime = 0;
    return { ok: true };
  }
  const users = await getUsersCollection();
  const filter = { username };
  if (puzzleId) filter.currentPuzzleId = puzzleId;
  const res = await users.updateOne(filter, { $set: { currentPuzzleId: null, currentPuzzleAnswers: null, currentPuzzleUpdatedAt: new Date(), currentPuzzleWrongAttempts: 0, currentPuzzleElapsedTime: 0 } });
  return { ok: res.matchedCount === 1 };
}

// Mark a puzzle as failed (unsuccessful) for a user
async function addFailedPuzzle(username, puzzleId) {
  username = username.toLowerCase();
  if (memoryMode) {
    const user = memoryUsers.find(u => u.username === username);
    if (!user) return { updated: false };
    if (!user.failedPuzzles) user.failedPuzzles = [];
    if (!user.failedPuzzles.includes(puzzleId)) user.failedPuzzles.push(puzzleId);
    if (!user.failedHistory) user.failedHistory = [];
    user.failedHistory.push({ puzzleId, failedAt: new Date() });
    return { updated: true, failedCount: user.failedPuzzles.length };
  }
  const users = await getUsersCollection();
  const res = await users.findOneAndUpdate(
    { username, failedPuzzles: { $ne: puzzleId } },
    { $addToSet: { failedPuzzles: puzzleId }, $push: { failedHistory: { puzzleId, failedAt: new Date() } } },
    { returnDocument: 'after', projection: { failedPuzzles: 1 } }
  );
  if (!res.value) {
    const existing = await users.findOne({ username }, { projection: { failedPuzzles: 1 } });
    return { updated: false, failedCount: existing?.failedPuzzles?.length || 0 };
  }
  return { updated: true, failedCount: res.value.failedPuzzles?.length || 0 };
}

async function incrementWrongAttempt(username, puzzleId) {
  username = username.toLowerCase();
  if (memoryMode) {
    const user = memoryUsers.find(u => u.username === username);
    if (!user || user.currentPuzzleId !== puzzleId) return { ok: false, count: 0 };
    user.currentPuzzleWrongAttempts = (user.currentPuzzleWrongAttempts || 0) + 1;
    user.currentPuzzleUpdatedAt = new Date();
    return { ok: true, count: user.currentPuzzleWrongAttempts };
  }
  const users = await getUsersCollection();
  const res = await users.findOneAndUpdate(
    { username, currentPuzzleId: puzzleId },
    { $inc: { currentPuzzleWrongAttempts: 1 }, $set: { currentPuzzleUpdatedAt: new Date() } },
    { returnDocument: 'after', projection: { currentPuzzleWrongAttempts: 1 } }
  );
  return { ok: !!res.value, count: res.value?.currentPuzzleWrongAttempts || 0 };
}

async function resetWrongAttempts(username, puzzleId) {
  username = username.toLowerCase();
  if (memoryMode) {
    const user = memoryUsers.find(u => u.username === username);
    if (!user || (puzzleId && user.currentPuzzleId !== puzzleId)) return { ok: false };
    user.currentPuzzleWrongAttempts = 0;
    user.currentPuzzleUpdatedAt = new Date();
    return { ok: true };
  }
  const users = await getUsersCollection();
  const filter = { username };
  if (puzzleId) filter.currentPuzzleId = puzzleId;
  const res = await users.updateOne(filter, { $set: { currentPuzzleWrongAttempts: 0, currentPuzzleUpdatedAt: new Date() } });
  return { ok: res.matchedCount === 1 };
}

module.exports = { connect, findUser, findUserByEmail, addUser, addUserWithPassword, verifyUserPassword, awardPointIfFirst, isMemoryMode, addPasswordResetRequest, listPasswordResetRequests, resolvePasswordResetRequest, deletePasswordResetRequest, setCurrentPuzzle, updateCurrentPuzzleAnswers, updateCurrentPuzzleElapsedTime, getCurrentPuzzleState, clearCurrentPuzzle, incrementWrongAttempt, resetWrongAttempts, addFailedPuzzle, addHistoryRequest, listHistoryRequests, resolveHistoryRequest, deleteHistoryRequest, addPuzzleRequest, listPuzzleRequests, resolvePuzzleRequest, deletePuzzleRequest, createPasswordResetToken, findValidResetToken, consumeResetToken, updateUserPassword };
