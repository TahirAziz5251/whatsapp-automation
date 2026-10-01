const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('/home/node/.n8n/database.sqlite');
const wfRow = db.prepare('SELECT * FROM workflow_entity WHERE id = ?').get('Ag4HbAjKlfHH6Xk7');

const { Workflow } = require('/usr/local/lib/node_modules/n8n/node_modules/.pnpm/n8n-workflow@file+packages+workflow_zod@3.25.67/node_modules/n8n-workflow/dist/cjs/workflow.js');

try {
  const nodes = JSON.parse(wfRow.nodes);
  const connections = JSON.parse(wfRow.connections);

  const wf = new Workflow({
    id: wfRow.id,
    name: wfRow.name,
    nodes: nodes,
    connections: connections,
    active: true,
    nodeTypes: {
      getByNameAndVersion: (name) => {
        return {
          description: {
            properties: [],
            name: name
          }
        };
      },
      getKnownTypes: () => ({})
    }
  });
  console.log('Workflow instantiated successfully!');

  // Now test start nodes
  const startNodes = wf.getStartNodes();
  console.log('Start nodes:', startNodes.map(n => n.name));

  // Test getChildNodes
  for (const node of nodes) {
    const children = wf.getChildNodes(node.name);
    console.log(`Node ${node.name} children:`, children);
  }

} catch (err) {
  console.error('ERROR TRACE:', err);
}
