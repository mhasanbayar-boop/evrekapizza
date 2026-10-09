/**
 * POS gönderim mantığı (outbox worker'ın çekirdeği).
 * Hedefler: sipariş kaybolmasın, POS'a asla çift gitmesin, belirsiz sonuçta körlemesine tekrar denenmesin.
 */
import { randomUUID } from 'node:crypto';
import { PosError, type PosOrderPayload, type PosPort } from './pos-port.ts';

export type TransferStatus = 'PENDING' | 'SUCCESS' | 'FAILED' | 'UNKNOWN';

export type TransferRecord = {
  id: string;
  orderId: string;
  attempt: number;
  idempotencyKey: string;
  status: TransferStatus;
  errorCode: string | null;
  posOrderRef: string | null;
};

export type TransferResult = {
  status: Exclude<TransferStatus, 'PENDING'>;
  errorCode?: string;
  posOrderRef?: string;
};

export interface TransferStore {
  /**
   * Atomik başlatma. Sipariş için:
   *  - SUCCESS kaydı varsa onu döner (started: false)
   *  - PENDING veya UNKNOWN kaydı varsa onu döner (started: false)
   *  - aksi halde yeni PENDING deneme açar (started: true)
   * PostgreSQL: SELECT ... FOR UPDATE + sipariş başına tek SUCCESS için kısmi unique index.
   */
  begin(orderId: string, idempotencyKey: string): Promise<{ record: TransferRecord; started: boolean }>;
  finish(id: string, result: TransferResult): Promise<void>;
}

export type DispatchOutcome =
  | { status: 'SKIPPED_DISABLED' }
  | { status: 'ALREADY_SENT'; posOrderRef: string }
  | { status: 'IN_PROGRESS' }
  | { status: 'NEEDS_RECONCILIATION'; transferId: string }
  | { status: 'SENT'; posOrderRef: string }
  | { status: 'FAILED'; retryable: boolean; code: string }
  | { status: 'UNKNOWN'; transferId: string };

/**
 * UNKNOWN kaydı otomatik yeniden denenmez. Personel POS'u kontrol eder, sonra
 * store.finish(id, { status: 'SUCCESS', posOrderRef }) veya
 * store.finish(id, { status: 'FAILED', errorCode: 'RECONCILED_NOT_SENT' }) ile çözer.
 */
export async function dispatchOrder(
  deps: { adapter: PosPort; store: TransferStore },
  order: PosOrderPayload,
): Promise<DispatchOutcome> {
  const { adapter, store } = deps;
  if (!adapter.enabled) return { status: 'SKIPPED_DISABLED' };

  const key = `order:${order.orderId}`;
  const { record, started } = await store.begin(order.orderId, key);
  if (!started) {
    if (record.status === 'SUCCESS') return { status: 'ALREADY_SENT', posOrderRef: record.posOrderRef ?? '' };
    if (record.status === 'UNKNOWN') return { status: 'NEEDS_RECONCILIATION', transferId: record.id };
    return { status: 'IN_PROGRESS' };
  }

  let posOrderRef: string;
  try {
    ({ posOrderRef } = await adapter.createOrder(order, key));
  } catch (err) {
    // PosError olmayan her hata da belirsiz sayılır: POS siparişi almış olabilir.
    const kind = err instanceof PosError ? err.kind : 'UNKNOWN_OUTCOME';
    if (kind === 'UNKNOWN_OUTCOME') {
      await store.finish(record.id, { status: 'UNKNOWN', errorCode: 'UNKNOWN_OUTCOME' });
      return { status: 'UNKNOWN', transferId: record.id };
    }
    await store.finish(record.id, { status: 'FAILED', errorCode: kind });
    return { status: 'FAILED', retryable: kind === 'TRANSIENT', code: kind };
  }

  await store.finish(record.id, { status: 'SUCCESS', posOrderRef });
  return { status: 'SENT', posOrderRef };
}

/** Test ve yerel geliştirme için. Üretimde Prisma/PostgreSQL uygulaması kullanılır. */
export class InMemoryTransferStore implements TransferStore {
  #records: TransferRecord[] = [];

  async begin(orderId: string, idempotencyKey: string): Promise<{ record: TransferRecord; started: boolean }> {
    // await içermez: kontrol ve ekleme tek iş parçacığında atomiktir.
    const mine = this.#records.filter((r) => r.orderId === orderId);
    const success = mine.find((r) => r.status === 'SUCCESS');
    if (success) return { record: { ...success }, started: false };
    const open = mine.find((r) => r.status === 'PENDING' || r.status === 'UNKNOWN');
    if (open) return { record: { ...open }, started: false };

    const record: TransferRecord = {
      id: randomUUID(),
      orderId,
      attempt: mine.length + 1,
      idempotencyKey,
      status: 'PENDING',
      errorCode: null,
      posOrderRef: null,
    };
    this.#records.push(record);
    return { record: { ...record }, started: true };
  }

  async finish(id: string, result: TransferResult): Promise<void> {
    const rec = this.#records.find((r) => r.id === id);
    if (!rec) throw new Error(`Transfer kaydı bulunamadı: ${id}`);
    rec.status = result.status;
    rec.errorCode = result.errorCode ?? null;
    rec.posOrderRef = result.posOrderRef ?? rec.posOrderRef;
  }

  all(): TransferRecord[] {
    return this.#records.map((r) => ({ ...r }));
  }
}
