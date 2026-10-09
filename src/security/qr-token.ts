/**
 * Sipariş QR token'ı.
 *  - 32 bayt rastgele değer (base64url, 43 karakter). QR yalnızca bu opak değeri taşır.
 *  - Veritabanında yalnızca SHA-256 hash'i saklanır.
 *  - Tek kullanımlık: tüketme işlemi ATOMİK olmalıdır (QrTokenStore.consume).
 *  - Yenilemede önceki token'lar iptal edilir (ekran görüntüsü kısa sürede işe yaramaz).
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';

export const DEFAULT_TTL_MS = 10 * 60 * 1000;

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export type TokenRecord = {
  id: string;
  orderId: string;
  tableId: string;
  tokenHash: string;
  createdAt: number;
  expiresAt: number;
  usedAt: number | null;
  usedBy: string | null;
  revokedAt: number | null;
};

export interface QrTokenStore {
  insert(record: TokenRecord): Promise<void>;
  findByHash(tokenHash: string): Promise<TokenRecord | null>;
  /**
   * Atomik tek kullanım. PostgreSQL karşılığı tek bir UPDATE olmalıdır:
   *
   *   UPDATE qr_tokens
   *      SET used_at = now(), used_by = $staff
   *    WHERE token_hash = $hash
   *      AND used_at IS NULL AND revoked_at IS NULL AND expires_at > now()
   *   RETURNING *;
   *
   * Satır dönmezse null döner. Önce SELECT sonra UPDATE yapılmamalıdır (yarış koşulu).
   */
  consume(tokenHash: string, now: number, staffId: string): Promise<TokenRecord | null>;
  /** Siparişin kullanılmamış, süresi dolmamış token'larını iptal eder; iptal sayısını döner. */
  revokeActiveForOrder(orderId: string, now: number): Promise<number>;
}

export type QrTokenErrorCode = 'MALFORMED' | 'NOT_FOUND' | 'ALREADY_USED' | 'REVOKED' | 'EXPIRED';

export class QrTokenError extends Error {
  readonly code: QrTokenErrorCode;
  constructor(code: QrTokenErrorCode) {
    super(`QR token reddedildi: ${code}`);
    this.name = 'QrTokenError';
    this.code = code;
  }
}

export function generateRawToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export async function issueToken(
  store: QrTokenStore,
  input: { orderId: string; tableId: string; ttlMs?: number },
  now: number = Date.now(),
): Promise<{ token: string; expiresAt: number; qrPath: string }> {
  await store.revokeActiveForOrder(input.orderId, now);
  const token = generateRawToken();
  const expiresAt = now + (input.ttlMs ?? DEFAULT_TTL_MS);
  await store.insert({
    id: randomUUID(),
    orderId: input.orderId,
    tableId: input.tableId,
    tokenHash: hashToken(token),
    createdAt: now,
    expiresAt,
    usedAt: null,
    usedBy: null,
    revokedAt: null,
  });
  // Web katmanı başına alan adını ekler. Bu adres giriş yapmamış birine hiçbir veri göstermez.
  return { token, expiresAt, qrPath: `/w/${token}` };
}

export async function redeemToken(
  store: QrTokenStore,
  rawToken: string,
  staffId: string,
  now: number = Date.now(),
): Promise<{ orderId: string; tableId: string }> {
  if (typeof rawToken !== 'string' || !TOKEN_PATTERN.test(rawToken)) throw new QrTokenError('MALFORMED');
  const hash = hashToken(rawToken);

  const consumed = await store.consume(hash, now, staffId);
  if (consumed) return { orderId: consumed.orderId, tableId: consumed.tableId };

  // Reddedildi: yalnızca yetkili garsona gösterilecek nedeni bul (bilgilendirme amaçlı, atomik değil).
  const existing = await store.findByHash(hash);
  if (!existing) throw new QrTokenError('NOT_FOUND');
  if (existing.usedAt !== null) throw new QrTokenError('ALREADY_USED');
  if (existing.revokedAt !== null) throw new QrTokenError('REVOKED');
  if (existing.expiresAt <= now) throw new QrTokenError('EXPIRED');
  throw new QrTokenError('NOT_FOUND');
}

/** Test ve yerel geliştirme için. Üretimde Prisma/PostgreSQL uygulaması kullanılır. */
export class InMemoryQrTokenStore implements QrTokenStore {
  #byHash = new Map<string, TokenRecord>();

  async insert(record: TokenRecord): Promise<void> {
    this.#byHash.set(record.tokenHash, { ...record });
  }

  async findByHash(tokenHash: string): Promise<TokenRecord | null> {
    const rec = this.#byHash.get(tokenHash);
    return rec ? { ...rec } : null;
  }

  async consume(tokenHash: string, now: number, staffId: string): Promise<TokenRecord | null> {
    // Kontrol ve güncelleme arasında await yok: tek iş parçacığında atomik.
    const rec = this.#byHash.get(tokenHash);
    if (!rec || rec.usedAt !== null || rec.revokedAt !== null || rec.expiresAt <= now) return null;
    rec.usedAt = now;
    rec.usedBy = staffId;
    return { ...rec };
  }

  async revokeActiveForOrder(orderId: string, now: number): Promise<number> {
    let count = 0;
    for (const rec of this.#byHash.values()) {
      if (rec.orderId === orderId && rec.usedAt === null && rec.revokedAt === null && rec.expiresAt > now) {
        rec.revokedAt = now;
        count += 1;
      }
    }
    return count;
  }
}
