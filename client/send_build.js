const axios = require('axios');
const fs = require('fs');
const path = require('path');

async function run() {
  const serverUrl = process.env.SERVER_URL || 'http://localhost:3000/build';
  const apiKey = process.env.API_KEY || null;
  const sampleName = process.env.SAMPLE || 'sample_vite_project.json';
  const samplePath = path.join(__dirname, sampleName);
  const raw = fs.readFileSync(samplePath, 'utf8');
  const payload = JSON.parse(raw);
  payload.waitForCompletion = process.env.WAIT === 'true' || false;

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers['x-api-key'] = apiKey;
    const res = await axios.post(serverUrl, payload, {
      responseType: 'stream',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'x-api-key': apiKey } : {})
      },
      maxContentLength: 1024 * 1024 * 100 // 100MB
    });

    const contentType = res.headers['content-type'] || '';
    if (contentType.includes('application/zip')) {
      const filePath = path.join(__dirname, `build-${Date.now()}.zip`);
      const writer = fs.createWriteStream(filePath);
      res.data.pipe(writer);
      writer.on('finish', () => {
        console.log('Saved build to', filePath);
      });
      writer.on('error', (err) => {
        console.error('Failed to save', err);
      });
    } else {
      // non-stream numeric 202 JSON response
      const chunks = [];
      res.data.on('data', c => chunks.push(c));
      res.data.on('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          console.log('Queued build', body);
        } catch (e) { console.log('Response', Buffer.concat(chunks).toString('utf8')); }
      });
    }
  } catch (err) {
    console.error('Build request failed', err.response?.data || err.message);
  }
}
async function runRepeated() {
  const runs = parseInt(process.env.RUNS || '1', 10);
  for (let i = 0; i < runs; i++) {
    console.log(`Run ${i+1} / ${runs}`);
    await run();
    if (i < runs-1) await new Promise(r => setTimeout(r, 2000));
  }
}
runRepeated();
