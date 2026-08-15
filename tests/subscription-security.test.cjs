const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  SUBSCRIPTION_TRANSPORT_LIMITS,
  fetchSubscriptionMaterial,
  isPublicSubscriptionAddress,
  parseSubscriptionUserInfo,
  resolveSafeSubscriptionTarget,
  safeSubscriptionUrlForLog,
  subscriptionHeadersForOrigin,
  validateSubscriptionUrl,
} = require('../dist-electron/subscription.js');

const blockedAddresses = [
  '0.0.0.0',
  '10.0.0.1',
  '100.64.0.1',
  '127.0.0.1',
  '169.254.169.254',
  '172.16.0.1',
  '172.31.255.255',
  '192.0.0.1',
  '192.0.2.1',
  '192.88.99.1',
  '192.168.1.1',
  '198.18.0.1',
  '198.51.100.1',
  '203.0.113.1',
  '224.0.0.1',
  '255.255.255.255',
  '::',
  '::1',
  '::ffff:8.8.8.8',
  '::192.168.1.1',
  '64:ff9b::808:808',
  '64:ff9b:1::1',
  '100::1',
  '2001::1',
  '2001:db8::1',
  '2002:0808:0808::1',
  '3fff::1',
  '5f00::1',
  'fc00::1',
  'fd12:3456:789a::1',
  'fe80::1',
  'ff02::1',
];
for (const address of blockedAddresses) {
  assert.equal(isPublicSubscriptionAddress(address), false, `${address} must be blocked`);
}

for (const address of ['1.1.1.1', '8.8.8.8', '93.184.216.34', '2606:4700:4700::1111']) {
  assert.equal(isPublicSubscriptionAddress(address), true, `${address} must be accepted`);
}

for (const value of [
  'http://subscriptions.example.org/list',
  'https://user:password@subscriptions.example.org/list',
  'https://127.0.0.1/list',
  'https://2130706433/list',
  'https://0x7f000001/list',
  'https://[::1]/list',
  'https://subscriptions.example.org:0/list',
  'https://localhost./list',
  'https://router.local/list',
  'https://single-label/list',
]) {
  assert.throws(() => validateSubscriptionUrl(value), undefined, `${value} must be rejected`);
}
assert.equal(validateSubscriptionUrl('https://subscriptions.example.org/list?token=secret').protocol, 'https:');

const secretUrl = 'https://user:password@subscriptions.example.org/private/path?token=top-secret&hwid=device-secret';
assert.equal(safeSubscriptionUrlForLog(secretUrl), 'https://subscriptions.example.org');
assert.equal(safeSubscriptionUrlForLog('not a URL'), 'некорректный адрес');
assert.equal(safeSubscriptionUrlForLog(secretUrl).includes('top-secret'), false);
assert.equal(safeSubscriptionUrlForLog(secretUrl).includes('device-secret'), false);
assert.equal(safeSubscriptionUrlForLog(secretUrl).includes('password'), false);

const sentHeaders = {
  'User-Agent': 'v2rayN/6.55',
  hwid: 'device-secret',
  'x-hwid': 'device-secret',
  Accept: 'text/plain',
};
assert.deepEqual(
  subscriptionHeadersForOrigin(sentHeaders, 'https://subscriptions.example.org', 'https://subscriptions.example.org'),
  sentHeaders,
  'HWID is retained for the explicitly trusted origin',
);
assert.deepEqual(
  subscriptionHeadersForOrigin(sentHeaders, 'https://redirect.example.net', 'https://subscriptions.example.org'),
  { 'User-Agent': 'v2rayN/6.55', Accept: 'text/plain' },
  'HWID is removed on a cross-origin redirect or discovered URL',
);
assert.equal(sentHeaders.hwid, 'device-secret', 'header filtering does not mutate the source object');

const malformedMetadata = parseSubscriptionUserInfo({
  'subscription-userinfo': `upload=999999999999999999999999; download=-1; total=1e9; expire=${'9'.repeat(64)}`,
  'profile-title': 'base64:!!!!',
  announce: 'Line\u0000Break',
  'profile-update-interval': '99999999999999999999',
}, 'https://subscriptions.example.org/list');
assert.equal(malformedMetadata.title, 'subscriptions.example.org');
assert.equal(malformedMetadata.upload, 0);
assert.equal(malformedMetadata.download, 0);
assert.equal(malformedMetadata.total, 0);
assert.equal(malformedMetadata.expireAt, undefined);
assert.equal(malformedMetadata.updateHours, 1);
assert.equal(malformedMetadata.announce, 'Line Break');

const oversizedMetadata = parseSubscriptionUserInfo({
  'profile-title': 'x'.repeat(4_097),
  announce: 'x'.repeat(4_097),
}, 'https://subscriptions.example.org/list');
assert.equal(oversizedMetadata.title, 'subscriptions.example.org');
assert.equal(oversizedMetadata.announce, undefined);

async function run() {
  const publicTarget = await resolveSafeSubscriptionTarget(
    'https://subscriptions.example.org/private/path?token=top-secret',
    async () => [{ address: '1.1.1.1', family: 4 }],
  );
  assert.deepEqual(publicTarget.addresses, [{ address: '1.1.1.1', family: 4 }]);

  await assert.rejects(
    resolveSafeSubscriptionTarget(
      'https://subscriptions.example.org/list',
      async () => [{ address: '10.0.0.1', family: 4 }],
    ),
    /локальный или служебный адрес/,
    'private DNS answers are blocked',
  );
  await assert.rejects(
    resolveSafeSubscriptionTarget(
      'https://subscriptions.example.org/list',
      async () => [
        { address: '1.1.1.1', family: 4 },
        { address: '127.0.0.1', family: 4 },
      ],
    ),
    /локальный или служебный адрес/,
    'a mixed public/private DNS answer is rejected in full',
  );
  await assert.rejects(
    resolveSafeSubscriptionTarget('https://subscriptions.example.org/list', async () => []),
    /не имеет доступных IP-адресов/,
  );

  let literalResolverCalls = 0;
  const literal = await resolveSafeSubscriptionTarget('https://1.1.1.1/list', async () => {
    literalResolverCalls += 1;
    return [];
  });
  assert.equal(literalResolverCalls, 0, 'IP literals bypass DNS but still pass address validation');
  assert.deepEqual(literal.addresses, [{ address: '1.1.1.1', family: 4 }]);

  const privateLogs = [];
  await assert.rejects(
    fetchSubscriptionMaterial(
      'https://127.0.0.1/private/path?token=top-secret&hwid=device-secret',
      'device-secret',
      (message) => privateLogs.push(message),
    ),
    /локальный адрес/,
    'the initial private target is rejected before a network request',
  );
  assert.equal(privateLogs.join('\n').includes('top-secret'), false);
  assert.equal(privateLogs.join('\n').includes('device-secret'), false);

  assert.equal(SUBSCRIPTION_TRANSPORT_LIMITS.maxRedirects, 5);
  // URL подписки + одна ссылка со страницы + до двух повторов по User-Agent.
  assert.equal(SUBSCRIPTION_TRANSPORT_LIMITS.maxRequests, 24);
  assert.equal(SUBSCRIPTION_TRANSPORT_LIMITS.maxResponseBytes, 8 * 1024 * 1024);
  assert.ok(SUBSCRIPTION_TRANSPORT_LIMITS.requestTimeoutMs > 0);
  assert.ok(SUBSCRIPTION_TRANSPORT_LIMITS.totalTimeoutMs >= SUBSCRIPTION_TRANSPORT_LIMITS.requestTimeoutMs);

  const source = fs.readFileSync(path.join(__dirname, '../src/main/subscription.ts'), 'utf8');
  const managerSource = fs.readFileSync(path.join(__dirname, '../src/main/vpn-manager.ts'), 'utf8');
  assert.equal(source.includes("redirect: 'follow'"), false, 'automatic redirect following must stay disabled');
  assert.equal(source.includes('hostname: address.address'), true, 'HTTPS connects to the validated DNS address');
  assert.equal(source.includes('servername:'), true, 'TLS SNI is preserved while the validated address is pinned');
  assert.equal(source.includes("responseHeader(response.headers, 'content-length')"), true, 'declared body size is checked');
  assert.equal(source.includes('size > SUBSCRIPTION_TRANSPORT_LIMITS.maxResponseBytes'), true, 'streamed body size is checked');
  assert.equal(source.includes("new TextDecoder('utf-8', { fatal: true })"), true, 'subscription payloads require valid UTF-8');
  assert.equal(source.includes("const SUBSCRIPTION_USER_AGENT = 'v2rayN/6.60'"), true, 'the provider receives one stable supported client identity');
  assert.equal(source.includes('candidateUrls('), false, 'subscription URLs must not be sprayed through query/path variants');
  assert.equal(source.match(/const SUBSCRIPTION_USER_AGENT/g)?.length, 1, 'subscription import keeps one client identity and does not spray retries');
  assert.match(source, /const response = await downloadOnce\(initialTarget\.toString\(\), SUBSCRIPTION_USER_AGENT\)/);
  assert.match(source, /if \(response\.status < 200 \|\| response\.status >= 300\)[\s\S]*throw new SubscriptionTransportError/);
  assert.match(source, /const address = addresses\[0\]/, 'a failed URL is not retried against every DNS address');
  assert.doesNotMatch(source, /for \(const address of addresses\)/, 'one failed provider attempt must stay one attempt');
  assert.match(source, /extractUrlsFromHtml\(body, response\.finalUrl\.toString\(\), \[/, 'an HTML landing page cannot link back into the same failed request');
  assert.equal(managerSource.includes('this.hwid.slice'), false, 'HWID fragments must never be written to subscription logs');

  console.log('subscription security tests: ok');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
