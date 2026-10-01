const { execSync } = require('child_process');

try {
  const output = execSync('tasklist', { encoding: 'utf8' });
  const lines = output.split('\n').filter(l => 
    l.toLowerCase().includes('docker') || 
    l.toLowerCase().includes('wsl') || 
    l.toLowerCase().includes('postgres') ||
    l.toLowerCase().includes('node')
  );
  console.log(lines.join('\n'));
} catch (err) {
  console.error('Error running tasklist:', err.message);
}
