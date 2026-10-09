import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTORS,
  InvalidTransitionError,
  ORDER_STATUSES,
  allowedNext,
  assertTransition,
  canTransition,
  isTerminal,
  type OrderStatus,
} from '../src/shared/order-state.ts';

test('müşteri garson onaylamadan önce iptal edebilir', () => {
  for (const s of ['PENDING', 'QR_CREATED', 'WAITING_WAITER'] as const) {
    assert.equal(canTransition(s, 'CANCELLED', 'CUSTOMER'), true, s);
  }
});

test('müşteri onaydan sonra iptal edemez', () => {
  for (const s of ['CONFIRMED', 'SENT_TO_POS', 'PREPARING', 'READY', 'SERVED', 'FAILED'] as const) {
    assert.equal(canTransition(s, 'CANCELLED', 'CUSTOMER'), false, s);
  }
});

test('onaydan sonra iptal yalnızca garson ve yöneticilerde', () => {
  for (const a of ['WAITER', 'MANAGER', 'ADMIN'] as const) {
    assert.equal(canTransition('CONFIRMED', 'CANCELLED', a), true, a);
  }
  assert.equal(canTransition('CONFIRMED', 'CANCELLED', 'KITCHEN'), false);
});

test('yalnızca garson ve yöneticiler onaylar; müşteri ve mutfak onaylayamaz', () => {
  for (const a of ['WAITER', 'MANAGER', 'ADMIN'] as const) {
    assert.equal(canTransition('WAITING_WAITER', 'CONFIRMED', a), true, a);
  }
  assert.equal(canTransition('WAITING_WAITER', 'CONFIRMED', 'CUSTOMER'), false);
  assert.equal(canTransition('WAITING_WAITER', 'CONFIRMED', 'KITCHEN'), false);
});

test('QR okutma (QR_CREATED → WAITING_WAITER) yalnızca garsonun işidir', () => {
  for (const a of ACTORS) {
    assert.equal(canTransition('QR_CREATED', 'WAITING_WAITER', a), a === 'WAITER', a);
  }
});

test('mutfak yalnızca hazırlık geçişlerini yapabilir', () => {
  const allowed = new Set(['SENT_TO_POS>PREPARING', 'PREPARING>READY']);
  for (const from of ORDER_STATUSES) {
    for (const to of ORDER_STATUSES) {
      const key = `${from}>${to}`;
      assert.equal(canTransition(from, to, 'KITCHEN'), allowed.has(key), key);
    }
  }
});

test('son durumlardan çıkış yoktur', () => {
  for (const s of ['COMPLETED', 'CANCELLED'] as const) {
    assert.equal(isTerminal(s), true, s);
    for (const a of ACTORS) assert.deepEqual(allowedNext(s, a), [], `${s}/${a}`);
  }
});

test('adım atlanamaz', () => {
  assert.equal(canTransition('PENDING', 'CONFIRMED', 'ADMIN'), false);
  assert.equal(canTransition('QR_CREATED', 'CONFIRMED', 'WAITER'), false);
  assert.equal(canTransition('CONFIRMED', 'SERVED', 'ADMIN'), false);
});

test('POS hatası yalnızca sistemden gelir; tekrar gönderim yetkililere açık', () => {
  assert.equal(canTransition('CONFIRMED', 'FAILED', 'SYSTEM'), true);
  assert.equal(canTransition('CONFIRMED', 'FAILED', 'WAITER'), false);
  for (const a of ['SYSTEM', 'WAITER', 'MANAGER', 'ADMIN'] as const) {
    assert.equal(canTransition('FAILED', 'SENT_TO_POS', a), true, a);
  }
  assert.equal(canTransition('FAILED', 'SENT_TO_POS', 'CUSTOMER'), false);
  assert.equal(canTransition('FAILED', 'SENT_TO_POS', 'KITCHEN'), false);
});

test('assertTransition geçersiz geçişte InvalidTransitionError fırlatır', () => {
  assert.throws(
    () => assertTransition('PENDING', 'SERVED', 'ADMIN'),
    (e: unknown) => e instanceof InvalidTransitionError && e.from === 'PENDING' && e.to === 'SERVED',
  );
  assertTransition('QR_CREATED', 'WAITING_WAITER', 'WAITER');
});

test("DRAFT'tan tüm durumlara ulaşılabilir (ölü durum yok)", () => {
  const seen = new Set<OrderStatus>(['DRAFT']);
  const queue: OrderStatus[] = ['DRAFT'];
  while (queue.length > 0) {
    const s = queue.pop() as OrderStatus;
    for (const a of ACTORS) {
      for (const n of allowedNext(s, a)) {
        if (!seen.has(n)) {
          seen.add(n);
          queue.push(n);
        }
      }
    }
  }
  assert.equal(seen.size, ORDER_STATUSES.length);
});
