const sqlite3 = require('/usr/local/lib/node_modules/n8n/node_modules/sqlite3');

const db = new sqlite3.Database('/home/node/.n8n/database.sqlite', sqlite3.OPEN_READONLY, (err) => {
  if (err) return console.error('DB Open Error:', err);

  db.all("SELECT id, name, active, updatedAt FROM workflow_entity;", (err, rows) => {
    if (err) return console.error('Workflow list error:', err);
    console.log('=== WORKFLOWS ===');
    console.log(rows);
  });

  db.all("SELECT id, workflowId, mode, retryOf, status, startedAt, stoppedAt FROM execution_entity ORDER BY id DESC LIMIT 10;", (err, rows) => {
    if (err) return console.error('Execution list error:', err);
    console.log('=== RECENT 10 EXECUTIONS ===');
    console.log(rows);
  });

  db.get("SELECT id, name, nodes, connections, settings FROM workflow_entity WHERE active = 1 LIMIT 1;", (err, row) => {
    if (err) return console.error('Active WF error:', err);
    if (!row) {
      console.log('No active workflow found in n8n database!');
      return;
    }
    console.log('=== ACTIVE WORKFLOW DETAILS ===');
    console.log('ID:', row.id, 'Name:', row.name);
    const nodes = JSON.parse(row.nodes);
    const webhook = nodes.find(n => n.type && n.type.includes('webhook'));
    console.log('Webhook node parameters:', JSON.stringify(webhook ? webhook.parameters : null, null, 2));
    console.log('Total nodes count:', nodes.length);
    console.log('Settings:', row.settings);
  });
});
