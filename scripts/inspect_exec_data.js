const sqlite3 = require('/usr/local/lib/node_modules/n8n/node_modules/sqlite3');

const db = new sqlite3.Database('/home/node/.n8n/database.sqlite', sqlite3.OPEN_READONLY, (err) => {
  if (err) return console.error('DB Open Error:', err);

  db.get("SELECT data FROM execution_data WHERE executionId = 2700;", (err, row) => {
    if (err) return console.error('Data error:', err);
    if (!row) {
      console.log('No execution data for 2700');
      return;
    }
    const data = JSON.parse(row.data);
    console.log('Execution 2700 ResultData:', JSON.stringify(data.resultData?.runData, null, 2));
  });
});
