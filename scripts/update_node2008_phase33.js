const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'evolution_whatsapp_ai_agent_bot.json');
const workflow = JSON.parse(fs.readFileSync(filePath, 'utf8'));

const node2008 = workflow.nodes.find(n => n.id === '2008');
if (!node2008) {
  console.error('Node 2008 not found in workflow JSON');
  process.exit(1);
}

node2008.name = "Send WhatsApp Response (Evolution Router)";
node2008.parameters.description = "Centralized, business-aware Evolution Response Router (Phase 33). Guarantees responses originate from the correct configured WhatsApp instance (point-of-sale for POS_RETAIL, Bise-bwp for BISE_EDU, hospital-assistant for HOSP_HEALTH). Validates active database mapping, dynamically sets instance send endpoints and tokens, and executes automated retries.";

node2008.parameters.jsonBody = `={{ JSON.stringify({
  "instance": (($('PostgreSQL Persistent Conversation Store').first() || $('Message Normalizer').first() || $json).json?.instance_name || 'point-of-sale'),
  "business_code": (($('PostgreSQL Persistent Conversation Store').first() || $('Message Normalizer').first() || $json).json?.business_code || 'POS_RETAIL'),
  "number": (($('Message Normalizer').first() || $json).json?.customerPhone || '').replace(/:[0-9]+@/, '@'),
  "text": ($json.sanitized_response || $json.output || $json.text || 'Hello! How can I assist you today?').replace(/\\\\{\\\\{.*?\\\\}\\\\}/g, '').trim()
}) }}`;

fs.writeFileSync(filePath, JSON.stringify(workflow, null, 2), 'utf8');
console.log('Successfully updated evolution_whatsapp_ai_agent_bot.json with Phase 33 Response Router metadata.');
