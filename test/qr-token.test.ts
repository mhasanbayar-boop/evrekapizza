import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  InMemoryQrTokenStore,
  QrTokenError,
  generateRawToken,
  hashToken,
  issueToken,
  redeemToken,
} from '../src/security/qr-token.ts';

const T0 = 1_000_000;

function isCode(code: string) {
  return (e: unknown) => e instanceof QrTokenError && e.code === code;
}

test('token bir kez kullanılabilir, ikinci okutma reddedilir', async () => {
  const store = new InMemoryQrTokenStore();
  const { token } = await issueToken(store, { orderId: 'o1', tableId: 't1' }, T0);
  const first = await redeemToken(store, token, 'garson-1', T0 + 1000);
  assert.deepEqual(first, { orderId: 'o1', tableId: 't1' });
  await assert.rejects(() => redeemToken(store, token, 'garson-2', T0 + 2000), isCode('ALREADY_USED'));
});

test('iki garson aynı anda okutursa yalnızca biri kazanır', async () => {
  const store = new InMemoryQrTokenStore();
  const { token } = await issueToken(store, { orderId: 'o1', tableId: 't1' }, T0);
  const results = await Promise.allSettled([
    redeemToken(store, token, 'garson-1', T0 + 1),
    redeemToken(store, token, 'garson-2', T0 + 1),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
  assert.equal(rejected.length, 1);
  assert.equal(isCode('ALREADY_USED')(rejected[0].reason), true);
});

test('süresi dolan token reddedilir (sınır dahil)', async () => {
  const store = new InMemoryQrTokenStore();
  const a = await issueToken(store, { orderId: 'o1', tableId: 't1', ttlMs: 60_000 }, T0);
  const b = await issueToken(store, { orderId: 'o2', tableId: 't2', ttlMs: 60_000 }, T0);
  assert.equal(a.expiresAt, T0 + 60_000);
  await assert.rejects(() => redeemToken(store, a.token, 'g', T0 + 60_000), isCode('EXPIRED'));
  assert.deepEqual(await redeemToken(store, b.token, 'g', T0 + 59_999), { orderId: 'o2', tableId: 't2' });
});

test('yenileme eskisini iptal eder: ekran görüntüsü işe yaramaz', async () => {
  const store = new InMemoryQrTokenStore();
  const first = await issueToken(store, { orderId: 'o1', tableId: 't1' }, T0);
  const second = await issueToken(store, { orderId: 'o1', tableId: 't1' }, T0 + 30_000);
  await assert.rejects(() => redeemToken(store, first.token, 'g', T0 + 31_000), isCode('REVOKED'));
  assert.deepEqual(await redeemToken(store, second.token, 'g', T0 + 31_000), { orderId: 'o1', tableId: 't1' });
});

test('biçimi bozuk veya bilinmeyen token reddedilir', async () => {
  const store = new InMemoryQrTokenStore();
  for (const bad of ['', 'abc', 'x'.repeat(44), `${'x'.repeat(42)}!`, '../../etc/passwd', 'a b'.repeat(15)]) {
    await assert.rejects(() => redeemToken(store, bad, 'g', T0), isCode('MALFORMED'));
  }
  await assert.rejects(() => redeemToken(store, 123 as unknown as string, 'g', T0), isCode('MALFORMED'));
  await assert.rejects(() => redeemToken(store, generateRawToken(), 'g', T0), isCode('NOT_FOUND'));
});

test('ham token saklanmaz; yalnızca SHA-256 hash tutulur', async () => {
  const store = new InMemoryQrTokenStore();
  const { token, qrPath } = await issueToken(store, { orderId: 'o1', tableId: 't1' }, T0);
  const rec = await store.findByHash(hashToken(token));
  if (!rec) throw new Error('kayıt bulunamadı');
  assert.equal(rec.tokenHash, hashToken(token));
  assert.equal(JSON.stringify(rec).includes(token), false);
  assert.equal(token.length, 43);
  assert.equal(hashToken(token).length, 64);
  assert.equal(qrPath, `/w/${token}`);
});

test('token rastgele ve benzersizdir', () => {
  const seen = new Set<string>();
  for (let i = 0; i < 2000; i += 1) seen.add(generateRawToken());
  assert.equal(seen.size, 2000);
});

test('kullanılan token, kullanan garsonu kaydeder', async () => {
  const store = new InMemoryQrTokenStore();
  const { token } = await issueToken(store, { orderId: 'o1', tableId: 't1' }, T0);
  await redeemToken(store, token, 'garson-7', T0 + 5);
  const rec = await store.findByHash(hashToken(token));
  if (!rec) throw new Error('kayıt bulunamadı');
  assert.equal(rec.usedBy, 'garson-7');
  assert.equal(rec.usedAt, T0 + 5);
});
