const assert = require('node:assert/strict');
const net = require('node:net');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const { VpnManager } = require(path.join(root, 'dist-electron', 'vpn-manager.js'));

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server.address().port;
}

async function close(server) {
  await new Promise((resolve) => server.close(resolve));
}

void (async () => {
  let requests = 0;
  const proxy = net.createServer((socket) => {
    let request = '';
    socket.on('data', (chunk) => {
      request += chunk.toString('latin1');
      if (!request.includes('\r\n\r\n')) return;
      requests += 1;
      assert.match(request, /^CONNECT 1\.1\.1\.1:443 HTTP\/1\.1\r\n/m);
      assert.doesNotMatch(request, /uuid|password|shareLink|subscription/i);
      setTimeout(() => socket.end('HTTP/1.1 200 Connection established\r\n\r\n'), 15);
    });
  });
  const httpPort = await listen(proxy);
  const manager = new VpnManager(path.join(root, '.latency-test-runtime'));
  manager.inboundPort = httpPort - 1;

  assert.equal(await manager.sampleLatency(), null, 'disconnected VPN must not generate probe traffic');
  assert.equal(requests, 0);

  manager.status = 'connected';
  manager.activeProfileId = 'safe-test-profile';
  const [first, deduplicated] = await Promise.all([manager.sampleLatency(), manager.sampleLatency()]);
  assert.ok(first && first.pingMs >= 1 && first.pingMs < 1000, 'tunnel latency sample is missing or implausible');
  assert.deepEqual(deduplicated, first, 'concurrent samples must share one safe probe');
  assert.match(first.measuredAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(requests, 1, 'concurrent IPC calls must not multiply tunnel traffic');

  manager.status = 'disconnected';
  manager.activeProfileId = null;
  assert.equal(await manager.sampleLatency(), null, 'sampling must stop after disconnect');
  assert.equal(requests, 1);

  await close(proxy);

  const fs = require('node:fs');
  const source = fs.readFileSync(path.join(root, 'src', 'main', 'vpn-manager.ts'), 'utf8');
  const method = source.slice(source.indexOf('sampleLatency()'), source.indexOf('async refreshSubscription', source.indexOf('sampleLatency()')));
  assert.match(method, /127\.0\.0\.1/);
  assert.match(method, /CONNECT 1\.1\.1\.1:443/);
  assert.doesNotMatch(method, /profile\.server|profile\.port/, 'connected sampling must not probe the VPN endpoint directly');

  const main = fs.readFileSync(path.join(root, 'src', 'main', 'main.ts'), 'utf8');
  const preload = fs.readFileSync(path.join(root, 'src', 'main', 'preload.ts'), 'utf8');
  const env = fs.readFileSync(path.join(root, 'src', 'renderer', 'env.d.ts'), 'utf8');
  const page = fs.readFileSync(path.join(root, 'src', 'renderer', 'Jey2RayPage.tsx'), 'utf8');
  const styles = fs.readFileSync(path.join(root, 'src', 'renderer', 'styles.css'), 'utf8');
  assert.match(main, /ipcMain\.handle\('vpn:latency-sample'/);
  assert.match(preload, /sampleVpnLatency:/);
  assert.match(env, /sampleVpnLatency\(\): Promise<VpnLatencySample \| null>/);
  assert.match(page, /runtime\.status === 'connected'.*className="tunnel-route"/s);
  assert.match(page, /<PingSparkline samples=\{latencySamples\}/);
  assert.doesNotMatch(page, /Math\.random/, 'sparkline must contain measured rather than synthetic data');
  assert.match(styles, /font-family: "Space Grotesk Variable"/);
  assert.match(styles, /font-family: "Inter Variable"/);
  assert.match(styles, /font-family: "JetBrains Mono Variable"/);
  assert.match(styles, /\.mode-switch button\.active \{ background: linear-gradient\(145deg, #776bea, #4f45bb\)/);

  console.log('VPN tunnel latency sampling regression checks passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
