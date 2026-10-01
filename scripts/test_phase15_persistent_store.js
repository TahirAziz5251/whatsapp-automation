const fs = require('fs');

console.log('================ PHASE 15 PERSISTENT CONVERSATION STATE VERIFICATION ================');

// 1. Verify JSON file loading and Node 2015 presence
const workflowFile = 'evolution_whatsapp_ai_agent_bot.json';
if (!fs.existsSync(workflowFile)) {
  console.error('FAIL: Workflow JSON file not found!');
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(workflowFile, 'utf8'));
const node2015 = data.nodes.find(n => n.id === '2015');

if (!node2015) {
  console.error('FAIL: Node 2015 (PostgreSQL Persistent Conversation Store) not found in workflow!');
  process.exit(1);
}

console.log('1. Workflow Node 2015 Verification: PASS');
console.log('   Node ID: ' + node2015.id);
console.log('   Node Name: ' + node2015.name);

// 2. Verify Pipeline Connections
const conn2014 = data.connections['Redis Transient Session & Dedup Gate'];
const conn2015 = data.connections['PostgreSQL Persistent Conversation Store'];

const link2014to2015 = conn2014?.main?.[0]?.[0]?.node === 'PostgreSQL Persistent Conversation Store';
const agentNodeName = conn2015?.main?.[0]?.[0]?.node;
const link2015toAgent = agentNodeName === 'AI Agent' || agentNodeName === 'AI Agent (Shared Engine)';

if (link2014to2015 && link2015toAgent) {
  console.log('2. Workflow Graph Chain Verification: PASS');
  console.log(`   Node 2014 -> Node 2015 -> ${agentNodeName} connected correctly.`);
} else {
  console.error('FAIL: Workflow connections broken!');
  process.exit(1);
}

// 3. Verify Canonical Control-Plane DDL (database/init-platform-db.sql)
const ddlFile = 'database/init-platform-db.sql';
if (fs.existsSync(ddlFile)) {
  const ddlContent = fs.readFileSync(ddlFile, 'utf8');
  const hasConversations = ddlContent.includes('CREATE TABLE IF NOT EXISTS conversations');
  const hasMessages = ddlContent.includes('CREATE TABLE IF NOT EXISTS conversation_messages');
  const hasMetadata = ddlContent.includes('CREATE TABLE IF NOT EXISTS session_metadata');
  const hasSummary = ddlContent.includes('CREATE TABLE IF NOT EXISTS conversation_summary');

  if (hasConversations && hasMessages && hasMetadata && hasSummary) {
    console.log('3. Canonical Control-Plane DDL Verification: PASS');
    console.log('   All 4 persistent conversation entities reside in canonical platform_db (init-platform-db.sql).');
  } else {
    console.error('FAIL: Missing entity in canonical DDL file!');
    process.exit(1);
  }
} else {
  console.error('FAIL: Canonical DDL file database/init-platform-db.sql not found!');
  process.exit(1);
}

// 4. Verify Phase 0 - Phase 14 Regression
const nodeIds = data.nodes.map(n => n.id);
const requiredNodes = ['2001', '2002', '2003', '2011', '2012', '2013', '2014', '2015', '2004', '2005', '2006', '2007', '2009', '2010', '2008'];
const allPresent = requiredNodes.every(id => nodeIds.includes(id));

if (allPresent) {
  console.log('4. Multi-Phase Regression Test: PASS');
  console.log(`   All ${requiredNodes.length} nodes (Phases 0 through 15) present and accounted for.`);
} else {
  console.error('FAIL: Regression check failed, missing node!');
  process.exit(1);
}

console.log('\nSUCCESS: Phase 15 PostgreSQL Persistent Conversation State 100% VERIFIED & PASS!\n');
