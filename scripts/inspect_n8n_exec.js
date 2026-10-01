const sqlite3 = require('/usr/local/lib/node_modules/n8n/node_modules/sqlite3');

const db = new sqlite3.Database('/home/node/.n8n/database.sqlite', sqlite3.OPEN_READONLY, (err) => {
  if (err) return console.error('DB Open Error:', err);

  db.get("SELECT id, status, mode, startedAt, stoppedAt FROM execution_entity WHERE id = 2700;", (err, row) => {
    if (err) return console.error('Row error:', err);
    console.log('Execution 2700:', row);
  });

  db.all("SELECT id, status, startedAt FROM execution_entity ORDER BY id DESC LIMIT 5;", (err, rows) => {
    if (err) return console.error('Rows error:', err);
    console.log('Latest 5 executions:', rows);
  });
});
