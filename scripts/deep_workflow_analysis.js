const fs = require('fs');
const path = require('path');

const wfPath = path.join(__dirname, '..', 'evolution_whatsapp_ai_agent_bot.json');
const wf = JSON.parse(fs.readFileSync(wfPath, 'utf8'));

console.log('=== WORKFLOW METADATA ===');
console.log('Workflow Name:', wf.name);
console.log('Total Nodes:', wf.nodes.length);
console.log('Settings:', JSON.stringify(wf.settings, null, 2));

console.log('\n=== NODE DIRECTORY ===');
wf.nodes.forEach((n, idx) => {
  console.log(`[${idx + 1}] "${n.name}" | Type: ${n.type} (v${n.typeVersion}) | ID: ${n.id}`);
});

console.log('\n=== COMPLETE CONNECTION GRAPH (DAG) ===');
for (const [source, connTypes] of Object.entries(wf.connections)) {
  for (const [type, outputs] of Object.entries(connTypes)) {
    outputs.forEach((group, outIdx) => {
      const targets = group.map(t => `"${t.node}" (pin ${t.index})`).join(', ');
      console.log(`  "${source}" [${type}:${outIdx}] ──▶ ${targets}`);
    });
  }
}

console.log('\n=== DETAILED NODE ANALYSIS ===');
wf.nodes.forEach((n, idx) => {
  console.log(`\n------------------------------------------------------------`);
  console.log(`Node [${idx + 1}]: "${n.name}"`);
  console.log(`Type: ${n.type} | ID: ${n.id}`);
  
  if (n.type.includes('webhook')) {
    console.log(`Webhook Path: ${n.parameters.path} | Method: ${n.parameters.httpMethod} | Options:`, n.parameters.options);
  } else if (n.type.includes('if')) {
    console.log(`Conditions:`, JSON.stringify(n.parameters.conditions, null, 2));
  } else if (n.type.includes('httpRequest')) {
    console.log(`HTTP Method: ${n.parameters.method} | URL: ${n.parameters.url}`);
    console.log(`Body Expression:`, n.parameters.jsonBody?.substring(0, 150) + '...');
  } else if (n.type.includes('agent')) {
    console.log(`Agent Options:`, JSON.stringify(n.parameters.options, null, 2));
    console.log(`System Prompt Preview:`, (n.parameters.options?.systemMessage || '').substring(0, 250) + '...');
  } else if (n.type.includes('code') || n.type.includes('toolCode')) {
    const code = n.parameters.jsCode || '';
    console.log(`Code Length: ${code.length} characters`);
    console.log(`Code First 5 Lines:`, code.split('\n').slice(0, 5).join('\n'));
    if (n.parameters.name) console.log(`Tool Name: ${n.parameters.name} | Description: ${n.parameters.description}`);
  } else if (n.type.includes('set')) {
    console.log(`Set Fields/Assignments:`, JSON.stringify(n.parameters.assignments || n.parameters.values, null, 2));
  }
});
