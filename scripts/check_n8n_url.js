const http = require('http');

function check(url) {
  return new Promise((resolve) => {
    console.log(`Checking ${url}...`);
    const req = http.get(url, { timeout: 3000 }, (res) => {
      console.log(`[STATUS ${res.statusCode}] for ${url}`);
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, length: data.length }));
    });
    req.on('timeout', () => {
      console.log(`[TIMEOUT] for ${url}`);
      req.destroy();
      resolve({ error: 'TIMEOUT' });
    });
    req.on('error', (err) => {
      console.log(`[ERROR: ${err.message}] for ${url}`);
      resolve({ error: err.message });
    });
  });
}

async function main() {
  await check('http://127.0.0.1:5678/healthz');
  await check('http://127.0.0.1:5678/workflow/Ag4HbAjKlfHH6Xk7');
}

main();
