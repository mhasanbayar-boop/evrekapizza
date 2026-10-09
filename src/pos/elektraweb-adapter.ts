import { PosError, type PosOrderPayload, type PosPort } from './pos-port.ts';

/**
 * ElektraWeb adapter İSKELETİ.
 *
 * Ekim 2026 araştırmasında ElektraWeb'in herkese açık, doğrulanabilir bir sipariş-gönderme
 * API dokümanı bulunamadı. Bu yüzden burada uç nokta, alan adı veya yetkilendirme YOKTUR
 * ve uydurulmamalıdır. Resmi doküman ve test ortamı geldiğinde yalnızca bu dosya doldurulur;
 * OrderService ve dispatcher değişmez.
 */
export class ElektraWebPosAdapter implements PosPort {
  readonly provider = 'elektraweb' as const;
  readonly enabled = true;

  async healthCheck(): Promise<{ ok: boolean; detail: string }> {
    return { ok: false, detail: 'ElektraWeb adapter uygulanmadı: resmi API dokümanı bekleniyor.' };
  }

  async createOrder(_order: PosOrderPayload, _idempotencyKey: string): Promise<{ posOrderRef: string }> {
    throw new PosError('NOT_CONFIGURED', 'ElektraWeb adapter uygulanmadı: resmi API dokümanı bekleniyor.');
  }
}
