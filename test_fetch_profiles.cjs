const http = require('http');

const body = JSON.stringify({ pageNo: 1, pageSize: 50 });
const req = http.request({
  hostname: '127.0.0.1',
  port: 40000,
  path: '/api/env/page',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'dbc21d41137f29238f4679e71b7986decb0581115e34a84e',
    'Content-Length': Buffer.byteLength(body),
  },
  timeout: 10000,
}, (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    const parsed = JSON.parse(data);
    if (parsed.code === 0 && parsed.data && parsed.data.dataList) {
      const profiles = parsed.data.dataList;
      console.log(`Total profiles: ${profiles.length}`);
      profiles.forEach(p => {
        console.log(`  ID: ${p.id} | Name: ${p.envName} | Status: ${p.status || 'unknown'}`);
      });
      // Find p-351 and p-348
      const p351 = profiles.find(p => p.envName && p.envName.includes('351'));
      const p348 = profiles.find(p => p.envName && p.envName.includes('348'));
      console.log('\n--- TARGET PROFILES ---');
      if (p351) console.log(`p-351: ID=${p351.id}, Name=${p351.envName}`);
      else console.log('p-351: NOT FOUND');
      if (p348) console.log(`p-348: ID=${p348.id}, Name=${p348.envName}`);
      else console.log('p-348: NOT FOUND');
    } else {
      console.log('API Response:', JSON.stringify(parsed, null, 2));
    }
  });
});
req.on('error', (err) => console.error('Error:', err.message));
req.on('timeout', () => { req.destroy(); console.error('Timeout'); });
req.write(body);
req.end();
