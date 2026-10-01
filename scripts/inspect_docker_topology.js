const { execSync } = require('child_process');

const containers = ['evolution-postgres', 'evolution-redis', 'evolution-go', 'n8n', 'n8n-automation-db-1'];

console.log('================ DOCKER TOPOLOGY AUDIT ================');
for (const c of containers) {
  try {
    const raw = execSync(`docker inspect ${c}`, { encoding: 'utf8' });
    const data = JSON.parse(raw)[0];
    console.log(`\nContainer: ${c}`);
    console.log(`  Image: ${data.Config.Image}`);
    console.log(`  State: ${data.State.Status}`);
    console.log(`  Ports: ${Object.keys(data.NetworkSettings.Ports || {}).join(', ')}`);
    console.log(`  Networks: ${Object.keys(data.NetworkSettings.Networks || {}).join(', ')}`);
    console.log(`  Mounts:`);
    for (const m of data.Mounts || []) {
      console.log(`    - ${m.Type}: ${m.Source} -> ${m.Destination}`);
    }
  } catch (err) {
    console.log(`  Error inspecting ${c}: ${err.message}`);
  }
}
