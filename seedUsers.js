// Sample user seeding script (MongoDB required)
// Usage:
//   node seedUsers.js                       -> seeds default users
//   node seedUsers.js alice bob charlie     -> seeds specified users (lowercased)
//   npm run seed                            -> uses package script (default users)

try { require('dotenv').config(); } catch (_) {}
const { addUserWithPassword, findUser, connect } = require('./db');

// DEFAULT_USERS supports either plain username OR username:password format.
// If password omitted, a default password 'password123' will be used.
const DEFAULT_USERS = [
  'testuser:test123',
  'player1:player1',
  'player2:player2',
  'guest:guest123',
  'demo:demo123',
  'admin:admin123'
];

async function seed(users) {
  await connect();
  const inserted = [];
  const skipped = [];
  for (const raw of users) {
    if (!raw) continue;
    let username = raw.trim();
    if (!username) continue;
    let password = 'password123';
    if (username.includes(':')) {
      const parts = username.split(':');
      username = parts[0];
      password = parts.slice(1).join(':') || password; // support passwords containing ':' after first
    }
    username = username.toLowerCase();
    const existing = await findUser(username);
    if (existing && existing.passwordHash) {
      skipped.push(username);
      continue;
    }
    await addUserWithPassword(username, password);
    inserted.push(`${username}`);
  }
  return { inserted, skipped };
}

(async () => {
  try {
    const cliUsers = process.argv.slice(2);
    const usersToSeed = cliUsers.length ? cliUsers : DEFAULT_USERS;
    console.log('[SEED] Starting user seeding...');
  console.log('[SEED] Target users:', usersToSeed.join(', '));
  console.log('[SEED] Format: username or username:password');
    const { inserted, skipped } = await seed(usersToSeed);
    console.log('\n[SEED] Summary');
    console.log('  Inserted:', inserted.length ? inserted.join(', ') : '(none)');
    console.log('  Skipped (already existed):', skipped.length ? skipped.join(', ') : '(none)');
    console.log('\n[SEED] Done.');
    process.exit(0);
  } catch (e) {
    if (e && (e.code === 'ECONNREFUSED' || /ECONNREFUSED/.test(e.message))) {
      console.error('\n[SEED] ERROR: Unable to connect to MongoDB.');
  console.error('[SEED] Make sure MongoDB is running on', process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017');
      console.error('[SEED] Example (Docker): docker run -d --name crossword-mongo -p 27017:27017 mongo:7');
      console.error('[SEED] Example (Local service): start the MongoDB Windows service or run mongod');
    } else {
      console.error('[SEED] Failed:', e && e.message ? e.message : e);
    }
    process.exit(1);
  }
})();
