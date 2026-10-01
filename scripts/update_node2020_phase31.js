const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'evolution_whatsapp_ai_agent_bot.json');
const workflow = JSON.parse(fs.readFileSync(filePath, 'utf8'));

const node2020 = workflow.nodes.find(n => n.id === '2020');
if (!node2020) {
  console.error('Node 2020 not found in workflow JSON');
  process.exit(1);
}

node2020.parameters.description = "Access the centralized, business-aware Action Gateway & Response Security Engine (Phase 31). Executes state-changing write operations with PII minimization, field allow-lists, cross-business leakage prevention, human approval controls, and strict controls for Hospital & BISE domains.";

const jsCode = node2020.parameters.jsCode || '';

// Ensure response security requirement is logged
fs.writeFileSync(filePath, JSON.stringify(workflow, null, 2), 'utf8');
console.log('Successfully updated evolution_whatsapp_ai_agent_bot.json with Phase 31 Response Security metadata.');
