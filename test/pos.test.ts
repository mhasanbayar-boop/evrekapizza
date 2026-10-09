import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DisabledPosAdapter,
  ElektraWebPosAdapter,
  InMemoryTransferStore,
  PosError,
  createPosAdapter,
  dispatchOrder,
  type PosErrorKind,
  type PosOrderPayload,
  type PosPort,
} from '../src/pos/index.ts';

const order: PosOrderPayload = {
  orderId: 'o-1',
  publicCode: 'ORD-20261008-AB1234',
  tableNumber: 12,
  posTableRef: null,
  note: null,
  totalKurus: 85000,
  lines: [
    {
      name: 'Sucuklu Pizza',
      qty: 2,
      unitPriceKurus: 35000,
      posProductRef: null,
      note: 'Pizza iyi pişsin.',
      options: [{ name: 'Peynirli kenar', posOptionRef: null }],
    },
  ],
};

type Step = () => Promise<{ posOrderRef: string }>;

const ok =
  (ref = 'POS-1'): Step =>
  async () => ({ posOrderRef: ref });
const fail =
  (kind: PosErrorKind): Step =>
  async () => {
    throw new PosError(kind, kind);
  };

class FakeAdapter implements PosPort {
  readonly provider = 'elektraweb' as const;
  readonly enabled = true;
  calls = 0;
  #script: Step[];

  constructor(script: Step[]) {
    this.#script = script;
  }

  async healthCheck(): Promise<{ ok: boolean; detail: string }> {
    return { ok: true, detail: 'sahte adapter' };
  }

  async createOrder(): Promise<{ posOrderRef: string }> {
    const step = this.#script[Math.min(this.calls, this.#script.length - 1)];
    this.calls += 1;
    return step();
  }
}

test('POS kapalıyken hiçbir şey gönderilmez ve kayıt açılmaz', async () => {
  const store = new InMemoryTransferStore();
  const out = await dispatchOrder({ adapter: new DisabledPosAdapter(), store }, order);
  assert.deepEqual(out, { status: 'SKIPPED_DISABLED' });
  assert.equal(store.all().length, 0);
});

test('başarılı gönderim bir kez yapılır; ikinci çağrı ALREADY_SENT döner', async () => {
  const adapter = new FakeAdapter([ok('POS-42')]);
  const store = new InMemoryTransferStore();
  assert.deepEqual(await dispatchOrder({ adapter, store }, order), { status: 'SENT', posOrderRef: 'POS-42' });
  assert.deepEqual(await dispatchOrder({ adapter, store }, order), { status: 'ALREADY_SENT', posOrderRef: 'POS-42' });
  assert.equal(adapter.calls, 1);
  assert.equal(store.all().length, 1);
});

test('eşzamanlı çift tıklama: POS yalnızca bir kez çağrılır', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const adapter = new FakeAdapter([
    async () => {
      await gate;
      return { posOrderRef: 'POS-7' };
    },
  ]);
  const store = new InMemoryTransferStore();
  const p1 = dispatchOrder({ adapter, store }, order);
  const p2 = dispatchOrder({ adapter, store }, order);
  assert.deepEqual(await p2, { status: 'IN_PROGRESS' });
  release();
  assert.deepEqual(await p1, { status: 'SENT', posOrderRef: 'POS-7' });
  assert.equal(adapter.calls, 1);
});

test('geçici hata: FAILED (otomatik denenebilir), sonraki deneme başarılı olur', async () => {
  const adapter = new FakeAdapter([fail('TRANSIENT'), ok('POS-9')]);
  const store = new InMemoryTransferStore();
  assert.deepEqual(await dispatchOrder({ adapter, store }, order), {
    status: 'FAILED',
    retryable: true,
    code: 'TRANSIENT',
  });
  assert.deepEqual(await dispatchOrder({ adapter, store }, order), { status: 'SENT', posOrderRef: 'POS-9' });
  const all = store.all();
  assert.deepEqual(all.map((r) => [r.attempt, r.status]), [
    [1, 'FAILED'],
    [2, 'SUCCESS'],
  ]);
});

test('kalıcı hata otomatik denenmez', async () => {
  const adapter = new FakeAdapter([fail('PERMANENT')]);
  const store = new InMemoryTransferStore();
  assert.deepEqual(await dispatchOrder({ adapter, store }, order), {
    status: 'FAILED',
    retryable: false,
    code: 'PERMANENT',
  });
});

test('belirsiz sonuç (zaman aşımı): otomatik tekrar yok, mutabakat gerekir, çift sipariş yok', async () => {
  const adapter = new FakeAdapter([fail('UNKNOWN_OUTCOME'), ok('POS-10')]);
  const store = new InMemoryTransferStore();

  const first = await dispatchOrder({ adapter, store }, order);
  if (first.status !== 'UNKNOWN') throw new Error('UNKNOWN bekleniyordu');

  const second = await dispatchOrder({ adapter, store }, order);
  assert.deepEqual(second, { status: 'NEEDS_RECONCILIATION', transferId: first.transferId });
  assert.equal(adapter.calls, 1);

  // Personel POS'u kontrol etti: sipariş gitmemiş. Kayıt çözülünce yeniden gönderilebilir.
  await store.finish(first.transferId, { status: 'FAILED', errorCode: 'RECONCILED_NOT_SENT' });
  assert.deepEqual(await dispatchOrder({ adapter, store }, order), { status: 'SENT', posOrderRef: 'POS-10' });
  assert.equal(adapter.calls, 2);
});

test('PosError olmayan beklenmedik hata da belirsiz sayılır', async () => {
  const adapter = new FakeAdapter([
    async () => {
      throw new TypeError('socket hang up');
    },
  ]);
  const store = new InMemoryTransferStore();
  const out = await dispatchOrder({ adapter, store }, order);
  assert.equal(out.status, 'UNKNOWN');
});

test('ElektraWeb iskeleti hiçbir şey uydurmaz: NOT_CONFIGURED döner, sipariş FAILED olarak kayıtlı kalır', async () => {
  const adapter = new ElektraWebPosAdapter();
  assert.equal((await adapter.healthCheck()).ok, false);
  await assert.rejects(
    () => adapter.createOrder(order, 'order:o-1'),
    (e: unknown) => e instanceof PosError && e.kind === 'NOT_CONFIGURED',
  );
  const store = new InMemoryTransferStore();
  assert.deepEqual(await dispatchOrder({ adapter, store }, order), {
    status: 'FAILED',
    retryable: false,
    code: 'NOT_CONFIGURED',
  });
  assert.equal(store.all()[0].status, 'FAILED');
});

test('createPosAdapter varsayılan olarak kapalıdır ve yanlış yapılandırmada hata verir', () => {
  assert.equal(createPosAdapter({}).provider, 'none');
  assert.equal(createPosAdapter({ POS_INTEGRATION_ENABLED: 'false', POS_PROVIDER: 'elektraweb' }).enabled, false);
  assert.equal(createPosAdapter({ POS_INTEGRATION_ENABLED: 'true', POS_PROVIDER: 'elektraweb' }).provider, 'elektraweb');
  assert.throws(() => createPosAdapter({ POS_INTEGRATION_ENABLED: 'true', POS_PROVIDER: 'baska' }));
  assert.throws(() => createPosAdapter({ POS_INTEGRATION_ENABLED: 'true' }));
});
