const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const possiblePaths = [
  path.join(process.env.APPDATA || '', 'pgadmin', 'pgadmin4.db'),
  path.join(process.env.APPDATA || '', 'pgAdmin', 'pgadmin4.db'),
  path.join(process.env.LOCALAPPDATA || '', 'pgadmin', 'pgadmin4.db'),
  path.join(process.env.LOCALAPPDATA || '', 'Programs', 'pgAdmin 4', 'pgadmin4.db'),
  'C:\\Users\\Tahir Aziz\\AppData\\Roaming\\pgadmin\\pgadmin4.db'
];

let dbFile = null;
for (const p of possiblePaths) {
  if (fs.existsSync(p)) {
    dbFile = p;
    break;
  }
}

console.log('=== PGADMIN DATABASE SEARCH ===');
if (!dbFile) {
  console.log('Could not find pgadmin4.db in standard locations.');
  // List directories in AppData\Roaming to find pgadmin folder
  const appData = process.env.APPDATA || '';
  if (fs.existsSync(appData)) {
    const dirs = fs.readdirSync(appData).filter(d => d.toLowerCase().includes('pg'));
    console.log('Directories in APPDATA matching "pg":', dirs);
  }
  process.exit(0);
}

console.log('Found pgadmin4.db at:', dbFile);

try {
  // Copy to temp file to avoid locking issues while pgAdmin is running
  const tempDb = path.join(__dirname, 'temp_pgadmin.db');
  fs.copyFileSync(dbFile, tempDb);
  
  const db = new DatabaseSync(tempDb);
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  console.log('Tables in pgadmin4.db:', tables.map(t => t.name));

  if (tables.some(t => t.name === 'server')) {
    const servers = db.prepare('SELECT id, name, host, port, maintenance_db, username FROM server').all();
    console.log('\n=== CONFIGURED SERVERS IN PGADMIN ===');
    console.log(JSON.stringify(servers, null, 2));
  } else {
    console.log('No server table found.');
  }

  db.close();
  fs.unlinkSync(tempDb);
} catch (e) {
  console.error('Error inspecting pgadmin4.db:', e.message);
}
