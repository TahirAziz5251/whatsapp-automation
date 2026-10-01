const fs = require('fs');
const path = require('path');

const wf = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'evolution_whatsapp_ai_agent_bot.json'), 'utf8'));

let out = '';
for (const [source, connTypes] of Object.entries(wf.connections)) {
  for (const [type, outputs] of Object.entries(connTypes)) {
    outputs.forEach((group, outIdx) => {
      const targets = group.map(t => `${t.node} [pin ${t.index}]`).join(', ');
      out += `${source} [${type}:${outIdx}] -> ${targets}\n`;
    });
  }
}

fs.writeFileSync(path.join(__dirname, 'graph.txt'), out, 'utf8');
console.log('Graph written to scripts/graph.txt successfully.');
