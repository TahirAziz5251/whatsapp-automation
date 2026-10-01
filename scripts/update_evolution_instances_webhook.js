const { Client } = require('pg');

async function main() {
  const client = new Client({
    host: '127.0.0.1',
    port: 5433,
    user: 'postgres',
    password: 'postgres',
    database: 'evogo_users'
  });

  try {
    await client.connect();
    console.log('Connected to evogo_users database on port 5433');

    const updateRes = await client.query(
      "UPDATE instances SET webhook = 'http://n8n:5678/webhook/evolution-whatsapp-agent' RETURNING id, name, webhook, events, connected"
    );

    console.log(`Successfully updated ${updateRes.rowCount} instance(s):`);
    updateRes.rows.forEach(row => {
      console.log(`- Instance: ${row.name} (${row.id}) => Webhook: ${row.webhook} | Events: ${row.events} | Connected: ${row.connected}`);
    });

  } catch (err) {
    console.error('Database update failed:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
