// Quick MongoDB Atlas connectivity test for this project (Node.js)
require('dotenv').config();
const { MongoClient, ServerApiVersion } = require('mongodb');

const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
const dbName = process.env.MONGODB_DB || process.env.MONGO_DB || 'crossworddb';

if (!uri) {
  console.error('[DB-PING] Missing MONGODB_URI (or MONGO_URI).');
  process.exit(1);
}

(async () => {
  const client = new MongoClient(uri, {
    serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true },
    serverSelectionTimeoutMS: 12000,
    connectTimeoutMS: 12000,
  });
  try {
    await client.connect();
    await client.db('admin').command({ ping: 1 });
    console.log('[DB-PING] OK: Connected and ping succeeded. dbName=%s', dbName);
  } catch (e) {
    console.error('[DB-PING] FAILED:', e.message);
    if (e.message && /bad auth|Authentication failed/i.test(e.message)) {
      console.error('\nTips:');
      console.error('- Recreate/reset the Atlas database user password and update MONGODB_URI.');
      console.error('- Ensure your current IP is allowed in Atlas Network Access.');
      console.error('- If your password has special characters, URL-encode it or choose a simpler dev password.');
      console.error('- Make sure you copied the Node.js connection string (not Python).');
    }
    process.exit(1);
  } finally {
    try { await client.close(); } catch(_) {}
  }
})();
