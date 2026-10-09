/**
 * Sipariş durum makinesi. Tasarım dokümanı Bölüm 4'teki tabloyla aynıdır.
 * Saf fonksiyonlar: veritabanı veya framework bağımlılığı yok.
 * ADMIN = RESTAURANT_ADMIN veya SUPER_ADMIN; MANAGER ayrı tutulur.
 */

export const ORDER_STATUSES = [
  'DRAFT',
  'PENDING',
  'QR_CREATED',
  'WAITING_WAITER',
  'CONFIRMED',
  'SENT_TO_POS',
  'PREPARING',
  'READY',
  'SERVED',
  'COMPLETED',
  'CANCELLED',
  'FAILED',
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ACTORS = ['CUSTOMER', 'WAITER', 'KITCHEN', 'MANAGER', 'ADMIN', 'SYSTEM'] as const;
export type Actor = (typeof ACTORS)[number];

const LEADS: readonly Actor[] = ['MANAGER', 'ADMIN'];

type Rule = { to: OrderStatus; actors: readonly Actor[] };

const RULES: Record<OrderStatus, readonly Rule[]> = {
  DRAFT: [{ to: 'PENDING', actors: ['CUSTOMER', 'SYSTEM'] }],
  PENDING: [
    { to: 'QR_CREATED', actors: ['SYSTEM'] },
    { to: 'CANCELLED', actors: ['CUSTOMER', 'SYSTEM'] },
  ],
  QR_CREATED: [
    { to: 'WAITING_WAITER', actors: ['WAITER'] },
    // müşteri iptali veya süre dolumu (neden: EXPIRED)
    { to: 'CANCELLED', actors: ['CUSTOMER', 'SYSTEM'] },
  ],
  WAITING_WAITER: [
    { to: 'CONFIRMED', actors: ['WAITER', ...LEADS] },
    // garson kilidi düştü, müşteri yeni QR alabilir
    { to: 'QR_CREATED', actors: ['SYSTEM'] },
    // garson onaylamadan önce müşteri iptal edebilir
    { to: 'CANCELLED', actors: ['CUSTOMER', 'WAITER', ...LEADS] },
  ],
  CONFIRMED: [
    // SYSTEM: worker. Personel: POS kapalıyken "POS'a elle girildi" işareti.
    { to: 'SENT_TO_POS', actors: ['SYSTEM', 'WAITER', ...LEADS] },
    { to: 'FAILED', actors: ['SYSTEM'] },
    { to: 'CANCELLED', actors: ['WAITER', ...LEADS] },
  ],
  SENT_TO_POS: [
    { to: 'PREPARING', actors: ['KITCHEN', 'SYSTEM', ...LEADS] },
    { to: 'COMPLETED', actors: ['SYSTEM', ...LEADS] },
    { to: 'CANCELLED', actors: ['WAITER', ...LEADS] },
  ],
  PREPARING: [{ to: 'READY', actors: ['KITCHEN', 'SYSTEM', ...LEADS] }],
  READY: [{ to: 'SERVED', actors: ['WAITER', ...LEADS] }],
  SERVED: [{ to: 'COMPLETED', actors: ['SYSTEM', ...LEADS] }],
  COMPLETED: [],
  CANCELLED: [],
  FAILED: [
    { to: 'SENT_TO_POS', actors: ['SYSTEM', 'WAITER', ...LEADS] },
    { to: 'CANCELLED', actors: ['WAITER', ...LEADS] },
  ],
};

export function canTransition(from: OrderStatus, to: OrderStatus, actor: Actor): boolean {
  return RULES[from].some((r) => r.to === to && r.actors.includes(actor));
}

export function allowedNext(from: OrderStatus, actor: Actor): OrderStatus[] {
  return RULES[from].filter((r) => r.actors.includes(actor)).map((r) => r.to);
}

export function isTerminal(status: OrderStatus): boolean {
  return RULES[status].length === 0;
}

export class InvalidTransitionError extends Error {
  readonly from: OrderStatus;
  readonly to: OrderStatus;
  readonly actor: Actor;
  constructor(from: OrderStatus, to: OrderStatus, actor: Actor) {
    super(`Geçersiz durum geçişi: ${from} → ${to} (${actor})`);
    this.name = 'InvalidTransitionError';
    this.from = from;
    this.to = to;
    this.actor = actor;
  }
}

export function assertTransition(from: OrderStatus, to: OrderStatus, actor: Actor): void {
  if (!canTransition(from, to, actor)) throw new InvalidTransitionError(from, to, actor);
}
