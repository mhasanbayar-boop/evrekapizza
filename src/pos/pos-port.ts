/**
 * POS arayüzü (port). OrderService yalnızca bunu bilir; sağlayıcıya özel kod adapter içindedir.
 *
 * Hata sınıflandırması dispatcher için kritiktir. Adapter yazarı şunlara uymalıdır:
 *  - TRANSIENT: POS siparişi KESİNLİKLE kabul etmedi (bağlantı kurulamadı, istek işlenmeden 503 vb.).
 *    Güvenle yeniden denenebilir.
 *  - PERMANENT: POS siparişi reddetti (eşleşmeyen ürün kodu, doğrulama hatası). Tekrar denemek işe yaramaz.
 *  - NOT_CONFIGURED: Adapter kapalı, yapılandırılmamış veya uygulanmamış.
 *  - UNKNOWN_OUTCOME: Sonuç bilinmiyor (zaman aşımı, yanıt okunamadı). Otomatik tekrar YAPILMAZ,
 *    çünkü POS siparişi almış olabilir ve tekrar göndermek çift sipariş üretir.
 * Kuşkuda UNKNOWN_OUTCOME seçilir.
 */

export type PosOrderLine = {
  name: string;
  qty: number;
  unitPriceKurus: number;
  /** products.pos_product_ref; ElektraWeb eşleme kuralı resmi dokümana göre belirlenecek. */
  posProductRef: string | null;
  note: string | null;
  options: readonly { name: string; posOptionRef: string | null }[];
};

export type PosOrderPayload = {
  orderId: string;
  publicCode: string;
  tableNumber: number;
  /** dining_tables.pos_table_ref */
  posTableRef: string | null;
  note: string | null;
  totalKurus: number;
  lines: readonly PosOrderLine[];
};

export type PosErrorKind = 'NOT_CONFIGURED' | 'TRANSIENT' | 'PERMANENT' | 'UNKNOWN_OUTCOME';

export class PosError extends Error {
  readonly kind: PosErrorKind;
  constructor(kind: PosErrorKind, message: string) {
    super(message);
    this.name = 'PosError';
    this.kind = kind;
  }
}

export interface PosPort {
  readonly provider: 'none' | 'elektraweb';
  /** false ise dispatcher hiçbir şey göndermez ve kayıt oluşturmaz. */
  readonly enabled: boolean;
  healthCheck(): Promise<{ ok: boolean; detail: string }>;
  /**
   * Siparişi POS'a iletir. idempotencyKey sipariş başına sabittir (`order:{id}`);
   * POS dış referans alanı destekliyorsa bu değer oraya yazılmalıdır.
   */
  createOrder(order: PosOrderPayload, idempotencyKey: string): Promise<{ posOrderRef: string }>;
}

/** Varsayılan adapter. POS_INTEGRATION_ENABLED=false iken kullanılır. */
export class DisabledPosAdapter implements PosPort {
  readonly provider = 'none' as const;
  readonly enabled = false;

  async healthCheck(): Promise<{ ok: boolean; detail: string }> {
    return { ok: true, detail: 'POS entegrasyonu kapalı (POS_INTEGRATION_ENABLED=false)' };
  }

  async createOrder(): Promise<never> {
    throw new PosError('NOT_CONFIGURED', 'POS entegrasyonu kapalı');
  }
}
