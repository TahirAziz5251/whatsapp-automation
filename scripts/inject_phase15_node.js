const fs = require('fs');

const file = 'evolution_whatsapp_ai_agent_bot.json';
const data = JSON.parse(fs.readFileSync(file, 'utf8'));

const node2015 = {
  parameters: {
    jsCode: `const { Client } = require('/usr/local/lib/node_modules/n8n/node_modules/pg');
const incoming = $input.first()?.json || {};

const sessionId = incoming.session_id || \`\${incoming.business_code || 'POS_RETAIL'}:\${incoming.instance_name || 'pos-instance'}:\${incoming.user_id || '923001234567'}\`;
const businessCode = incoming.business_code || 'POS_RETAIL';
const instanceName = incoming.instance_name || 'pos-instance';
const userId = incoming.user_id || '923001234567';
const customerPhone = incoming.customerPhone || userId;
const pushName = incoming.pushName || 'Customer';
const messageId = incoming.message_id || 'MSG_INIT';
const messageText = incoming.message || incoming.messageText || '';

let durableSummary = '';
let recentMessagesCount = 0;
let dbPersisted = false;

try {
  const client = new Client({ connectionString: 'postgresql://postgres:postgres@evolution-postgres:5432/platform_db' });
  await client.connect();

  const convQuery = \`
    INSERT INTO conversations (conversation_id, session_key, business_code, instance_name, user_id, customer_phone, push_name, status, last_active_at)
    VALUES ($1, $1, $2, $3, $4, $5, $6, 'ACTIVE', CURRENT_TIMESTAMP)
    ON CONFLICT (conversation_id) 
    DO UPDATE SET 
      message_count = conversations.message_count + 1,
      push_name = EXCLUDED.push_name,
      last_active_at = CURRENT_TIMESTAMP;
  \`;
  await client.query(convQuery, [sessionId, businessCode, instanceName, userId, customerPhone, pushName]);

  const sessQuery = \`
    INSERT INTO session_metadata (session_key, business_code, user_id, current_intent, last_sync_at)
    VALUES ($1, $2, $3, 'GENERAL', CURRENT_TIMESTAMP)
    ON CONFLICT (session_key) 
    DO UPDATE SET last_sync_at = CURRENT_TIMESTAMP;
  \`;
  await client.query(sessQuery, [sessionId, businessCode, userId]);

  if (messageText) {
    const msgQuery = \`
      INSERT INTO conversation_messages (conversation_id, message_id, sender_type, sender_phone, message_text, metadata)
      VALUES ($1, $2, 'USER', $3, $4, $5)
      ON CONFLICT DO NOTHING;
    \`;
    await client.query(msgQuery, [sessionId, messageId, customerPhone, messageText, JSON.stringify({ source: 'whatsapp', instance: instanceName })]);
  }

  const sumRes = await client.query('SELECT summary_text FROM conversation_summary WHERE conversation_id = $1 ORDER BY updated_at DESC LIMIT 1;', [sessionId]);
  if (sumRes.rows.length > 0) durableSummary = sumRes.rows[0].summary_text;

  const historyRes = await client.query('SELECT COUNT(*)::int as count FROM conversation_messages WHERE conversation_id = $1;', [sessionId]);
  if (historyRes.rows.length > 0) recentMessagesCount = historyRes.rows[0].count;

  await client.end();
  dbPersisted = true;
} catch (e) {
  console.error('PostgreSQL Persistent Store Error:', e.message);
}

return {
  ...incoming,
  persistent_conversation_store: {
    conversation_id: sessionId,
    db_persisted: dbPersisted,
    durable_summary: durableSummary,
    total_messages_count: recentMessagesCount,
    storage: 'PostgreSQL platform_db (durable restart-safe)'
  }
};`
  },
  id: "2015",
  name: "PostgreSQL Persistent Conversation Store",
  type: "n8n-nodes-base.code",
  typeVersion: 2,
  position: [
    -210,
    1900
  ]
};

const existingIdx = data.nodes.findIndex(n => n.id === '2015');
if (existingIdx >= 0) {
  data.nodes[existingIdx] = node2015;
} else {
  const idx2014 = data.nodes.findIndex(n => n.id === '2014');
  if (idx2014 >= 0) {
    data.nodes.splice(idx2014 + 1, 0, node2015);
  } else {
    data.nodes.push(node2015);
  }
}

data.connections["Redis Transient Session & Dedup Gate"] = {
  main: [
    [
      {
        node: "PostgreSQL Persistent Conversation Store",
        type: "main",
        index: 0
      }
    ]
  ]
};

data.connections["PostgreSQL Persistent Conversation Store"] = {
  main: [
    [
      {
        node: "AI Agent",
        type: "main",
        index: 0
      }
    ]
  ]
};

fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
console.log('SUCCESS: Injected Node 2015 into evolution_whatsapp_ai_agent_bot.json');
