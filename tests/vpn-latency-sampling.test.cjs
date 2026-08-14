const assert = require('node:assert/strict');
const net = require('node:net');
const tls = require('node:tls');
const path = require('node:path');

const nativeTlsConnect = tls.connect;
tls.connect = ({ socket }) => {
  process.nextTick(() => socket.emit('secureConnect'));
  return socket;
};

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
  let remoteRequests = 0;
  const proxy = net.createServer((socket) => {
    let request = '';
    let tunnelReady = false;
    socket.on('data', (chunk) => {
      request += chunk.toString('latin1');
      const end = request.indexOf('\r\n\r\n');
      if (end < 0) return;
      const message = request.slice(0, end + 4);
      request = request.slice(end + 4);
      if (!tunnelReady) {
        requests += 1;
        assert.match(message, /^CONNECT cp\.cloudflare\.com:443 HTTP\/1\.1\r\n/m);
        assert.doesNotMatch(message, /uuid|password|shareLink|subscription/i);
        tunnelReady = true;
        socket.write('HTTP/1.1 200 Connection established\r\n\r\n');
        return;
      }
      assert.match(message, /^GET \/generate_204\?nexus=[a-z0-9-]+ HTTP\/1\.1\r\n/m);
      assert.match(message, /\r\nHost: cp\.cloudflare\.com\r\n/i);
      remoteRequests += 1;
      const warmup = remoteRequests === 1;
      setTimeout(() => socket.write([
        'HTTP/1.1 204 No Content',
        'Server: remote-test',
        `Connection: ${warmup ? 'keep-alive' : 'close'}`,
        '',
        '',
      ].join('\r\n')), warmup ? 140 : 75);
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
  assert.ok(first && first.pingMs >= 60 && first.pingMs < 130, 'sample must time the warm TLS tunnel round trip, not the slower setup request');
  assert.deepEqual(deduplicated, first, 'concurrent samples must share one safe probe');
  assert.match(first.measuredAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(requests, 1, 'concurrent IPC calls must not multiply tunnel traffic');
  assert.equal(remoteRequests, 2, 'one verified warmup and one measured HTTPS response are required');

  manager.status = 'disconnected';
  manager.activeProfileId = null;
  assert.equal(await manager.sampleLatency(), null, 'sampling must stop after disconnect');
  assert.equal(requests, 1);

  await close(proxy);

  const fallbackTargets = [];
  let fallbackRemoteRequests = 0;
  const fallbackProxy = net.createServer((socket) => {
    let request = '';
    let tunnelReady = false;
    socket.on('data', (chunk) => {
      request += chunk.toString('latin1');
      const end = request.indexOf('\r\n\r\n');
      if (end < 0) return;
      const message = request.slice(0, end + 4);
      request = request.slice(end + 4);
      if (!tunnelReady) {
        const target = message.match(/^CONNECT ([^:]+):443 HTTP\/1\.1/m)?.[1];
        assert.ok(target);
        fallbackTargets.push(target);
        if (target === 'cp.cloudflare.com') return; // Simulate a slow regional route.
        assert.equal(target, 'www.gstatic.com');
        tunnelReady = true;
        socket.write('HTTP/1.1 200 Connection established\r\n\r\n');
        return;
      }
      assert.match(message, /\r\nHost: www\.gstatic\.com\r\n/i);
      fallbackRemoteRequests += 1;
      socket.write([
        'HTTP/1.1 204 No Content',
        'Server: fallback-test',
        `Connection: ${fallbackRemoteRequests === 1 ? 'keep-alive' : 'close'}`,
        '',
        '',
      ].join('\r\n'));
    });
  });
  const fallbackHttpPort = await listen(fallbackProxy);
  manager.inboundPort = fallbackHttpPort - 1;
  manager.status = 'connected';
  manager.activeProfileId = 'fallback-test-profile';
  manager.lastLatencySample = null;
  const fallbackStarted = Date.now();
  const fallbackSample = await manager.sampleLatency();
  const fallbackElapsed = Date.now() - fallbackStarted;
  assert.ok(fallbackSample && fallbackSample.pingMs > 0, 'an alternate verified HTTPS target must recover a stalled regional probe');
  assert.deepEqual(fallbackTargets, ['cp.cloudflare.com', 'www.gstatic.com']);
  assert.equal(fallbackRemoteRequests, 2);
  assert.ok(fallbackElapsed >= 800 && fallbackElapsed < 2500, `fallback must replace the long timeout (${fallbackElapsed} ms)`);
  await close(fallbackProxy);
  tls.connect = nativeTlsConnect;

  const fs = require('node:fs');
  const source = fs.readFileSync(path.join(root, 'src', 'main', 'vpn-manager.ts'), 'utf8');
  const method = source.slice(source.indexOf('sampleLatency()'), source.indexOf('async refreshSubscription', source.indexOf('sampleLatency()')));
  assert.match(method, /127\.0\.0\.1/);
  assert.match(method, /probeTunnelLatencyTarget\('cp\.cloudflare\.com'/);
  assert.match(method, /'www\.gstatic\.com'/);
  assert.match(method, /fallbackDelayMs = 900/);
  assert.match(method, /CONNECT \$\{targetHost\}:443/);
  assert.match(method, /connectTls\(\{/);
  assert.match(method, /rejectUnauthorized: true/);
  assert.match(method, /GET \/generate_204\?nexus=/);
  assert.match(method, /warmupComplete/);
  assert.match(method, /HTTP\\\/1\\\.\[01\]\\s\+204/, 'only a real remote generate_204 response may complete the sample');
  assert.doesNotMatch(method, /CONNECT 1\.1\.1\.1:443/, 'the old loopback-only probe must not return');
  assert.doesNotMatch(method, /profile\.server|profile\.port/, 'connected sampling must not probe the VPN endpoint directly');

  const main = fs.readFileSync(path.join(root, 'src', 'main', 'main.ts'), 'utf8');
  const preload = fs.readFileSync(path.join(root, 'src', 'main', 'preload.ts'), 'utf8');
  const env = fs.readFileSync(path.join(root, 'src', 'renderer', 'env.d.ts'), 'utf8');
  const geo = fs.readFileSync(path.join(root, 'src', 'main', 'vpn-geo.ts'), 'utf8');
  const page = fs.readFileSync(path.join(root, 'src', 'renderer', 'Jey2RayPage.tsx'), 'utf8');
  const styles = fs.readFileSync(path.join(root, 'src', 'renderer', 'styles.css'), 'utf8');
  assert.match(main, /ipcMain\.handle\('vpn:latency-sample'/);
  assert.match(preload, /sampleVpnLatency:/);
  assert.match(env, /sampleVpnLatency\(\): Promise<VpnLatencySample \| null>/);
  assert.match(geo, /city: hit\.city/);
  assert.match(geo, /lang=ru/);
  assert.match(geo, /version: 2, locale: 'ru'/);
  assert.match(page, /runtime\.status === 'connected'.*className="tunnel-route"/s);
  assert.match(page, /profile\.city/);
  assert.match(page, /Подключено/);
  assert.match(page, /setInterval\(\(\) => void sample\(\), 3000\)/);
  assert.match(page, /tunnel-session-counter/);
  assert.match(page, /switchVpnMode\(next\)/);
  assert.doesNotMatch(page, /PingSparkline|tunnel-ping|latencySamples/, 'the latency graph and its history must stay removed');
  assert.doesNotMatch(page, /fallback=\{activeProfile\?\.pingMs\}/, 'endpoint TCP latency must not appear as tunnel latency');
  assert.doesNotMatch(page, /Работает ·|127\.0\.0\.1|Системный Proxy/);
  assert.doesNotMatch(page, /routing-summary/, 'technical routing summary must stay off the main screen');
  assert.doesNotMatch(page, /Math\.random/, 'sparkline must contain measured rather than synthetic data');
  assert.match(styles, /font-family: "Space Grotesk Variable"/);
  assert.match(styles, /font-family: "Inter Variable"/);
  assert.match(styles, /font-family: "JetBrains Mono Variable"/);
  assert.match(styles, /\.mode-switch button\.active \{ background: linear-gradient\(145deg, #776bea, #4f45bb\)/);
  assert.match(styles, /\.tunnel-session-counter .*font-family: var\(--font-body\)/);
  assert.doesNotMatch(styles, /\.tunnel-ping/, 'latency graph styling must stay removed');

  console.log('VPN tunnel latency sampling regression checks passed.');
})().catch((error) => {
  tls.connect = nativeTlsConnect;
  console.error(error);
  process.exitCode = 1;
});
