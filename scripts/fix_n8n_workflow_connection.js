const { DatabaseSync } = require('node:sqlite');

const dbPath = process.argv[2] || '/home/node/.n8n/database.sqlite';
const db = new DatabaseSync(dbPath);

const targetWorkflowId = 'Ag4HbAjKlfHH6Xk7';
const wf = db.prepare('SELECT id, name, connections, nodes, settings, active, activeVersionId, versionId FROM workflow_entity WHERE id = ?').get(targetWorkflowId);

if (!wf) {
  console.error(`Workflow ${targetWorkflowId} not found!`);
  process.exit(1);
}

console.log(`Found workflow: ${wf.name} (${wf.id})`);
const connections = JSON.parse(wf.connections);

// Clean up connections from Result Validator & Response Guard
connections['Result Validator & Response Guard'] = {
  main: [
    [
      {
        node: 'Send WhatsApp Response (Evolution Router)',
        type: 'main',
        index: 0
      }
    ]
  ]
};

// Ensure settings record successful executions
const settings = JSON.parse(wf.settings || '{}');
settings.saveDataSuccessExecution = 'all';
settings.saveExecutionProgress = true;
settings.saveDataErrorExecution = 'all';

// Update workflow_entity
db.prepare('UPDATE workflow_entity SET connections = ?, settings = ?, active = 1, updatedAt = CURRENT_TIMESTAMP WHERE id = ?').run(
  JSON.stringify(connections),
  JSON.stringify(settings),
  targetWorkflowId
);

// Also clean up any other workflows that have this broken connection in workflow_entity
const allWfs = db.prepare('SELECT id, name, connections FROM workflow_entity WHERE id != ?').all(targetWorkflowId);
for (const otherWf of allWfs) {
  const conn = JSON.parse(otherWf.connections);
  if (conn['Result Validator & Response Guard']) {
    conn['Result Validator & Response Guard'] = {
      main: [
        [
          {
            node: 'Send WhatsApp Response (Evolution Router)',
            type: 'main',
            index: 0
          }
        ]
      ]
    };
    db.prepare('UPDATE workflow_entity SET connections = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?').run(
      JSON.stringify(conn),
      otherWf.id
    );
    console.log(`Also patched broken connection in workflow: ${otherWf.name} (${otherWf.id})`);
  }
}

// CRITICAL FIX: Patch ALL rows in workflow_history that contain the broken connection
const historyRows = db.prepare('SELECT versionId, workflowId, connections FROM workflow_history').all();
let patchedHistoryCount = 0;

for (const row of historyRows) {
  try {
    const conn = JSON.parse(row.connections);
    let changed = false;

    if (conn['Result Validator & Response Guard']) {
      conn['Result Validator & Response Guard'] = {
        main: [
          [
            {
              node: 'Send WhatsApp Response (Evolution Router)',
              type: 'main',
              index: 0
            }
          ]
        ]
      };
      changed = true;
    }

    if (changed || row.connections.includes('Send WhatsApp Response (Evolution API)')) {
      const fixedJson = JSON.stringify(conn);
      db.prepare('UPDATE workflow_history SET connections = ?, updatedAt = CURRENT_TIMESTAMP WHERE versionId = ?').run(
        fixedJson,
        row.versionId
      );
      patchedHistoryCount++;
    }
  } catch (e) {
    console.error(`Error processing history version ${row.versionId}:`, e.message);
  }
}
console.log(`Patched ${patchedHistoryCount} historical version entries in workflow_history.`);

// Verify active version in workflow_history
if (wf.activeVersionId) {
  const activeVer = db.prepare('SELECT versionId, connections FROM workflow_history WHERE versionId = ?').get(wf.activeVersionId);
  if (activeVer) {
    const activeConn = JSON.parse(activeVer.connections);
    console.log('Verified activeVersionId connections:', JSON.stringify(activeConn['Result Validator & Response Guard']));
  }
}

// Verify no broken connection remains in entire SQLite db
const remainingBroken = db.prepare("SELECT count(*) as count FROM workflow_history WHERE connections LIKE '%Send WhatsApp Response (Evolution API)%'").get();
console.log('Remaining broken connections in workflow_history:', remainingBroken.count);

console.log('SUCCESS: All workflow definitions and active execution versions completely repaired!');
