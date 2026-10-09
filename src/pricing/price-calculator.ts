/**
 * Sunucu tarafı fiyat hesabı. İstemci fiyat göndermez; yalnızca ürün ID'si,
 * seçenek ID'leri, adet ve not gönderir. Katalog veritabanından gelir.
 * Tüm tutarlar tamsayı kuruştur.
 */

export type Availability = 'IN_STOCK' | 'SOLD_OUT' | 'TEMP_OFF';

export type OptionValueDef = {
  id: string;
  name: string;
  priceDeltaKurus: number;
  available: boolean;
};

export type OptionGroupDef = {
  id: string;
  name: string;
  selection: 'SINGLE' | 'MULTI';
  minSelect: number;
  maxSelect: number;
  required: boolean;
  values: readonly OptionValueDef[];
};

export type ProductDef = {
  id: string;
  name: string;
  basePriceKurus: number;
  availability: Availability;
  active: boolean;
  optionGroups: readonly OptionGroupDef[];
};

export type CartLineInput = {
  productId: string;
  optionValueIds: readonly string[];
  qty: number;
  note?: string;
};

export type PricedOption = { optionValueId: string; name: string; priceDeltaKurus: number };

export type PricedLine = {
  productId: string;
  name: string;
  qty: number;
  unitPriceKurus: number;
  lineTotalKurus: number;
  note: string | null;
  options: PricedOption[];
};

export type Quote = {
  lines: PricedLine[];
  subtotalKurus: number;
  extraFeeKurus: number;
  totalKurus: number;
};

export type PricingErrorCode =
  | 'EMPTY_CART'
  | 'TOO_MANY_LINES'
  | 'INVALID_QTY'
  | 'UNKNOWN_PRODUCT'
  | 'PRODUCT_UNAVAILABLE'
  | 'UNKNOWN_OPTION'
  | 'UNAVAILABLE_OPTION'
  | 'DUPLICATE_OPTION'
  | 'OPTION_RULE_VIOLATION'
  | 'INVALID_NOTE'
  | 'NOTE_TOO_LONG'
  | 'INVALID_PRICE_DATA';

export class PricingError extends Error {
  readonly code: PricingErrorCode;
  readonly lineIndex: number | null;
  constructor(code: PricingErrorCode, message: string, lineIndex: number | null = null) {
    super(message);
    this.name = 'PricingError';
    this.code = code;
    this.lineIndex = lineIndex;
  }
}

export const LIMITS = { maxLines: 50, maxQty: 50, maxNoteLength: 200 } as const;

const CONTROL_CHARS = /[\u0000-\u001F\u007F]/g;

function isKurus(n: unknown): n is number {
  return typeof n === 'number' && Number.isSafeInteger(n);
}

function normalizeNote(raw: unknown, index: number): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'string') throw new PricingError('INVALID_NOTE', 'Not metin olmalı', index);
  const clean = raw.replace(CONTROL_CHARS, ' ').trim();
  if (clean.length > LIMITS.maxNoteLength) {
    throw new PricingError('NOTE_TOO_LONG', `Not en fazla ${LIMITS.maxNoteLength} karakter olabilir`, index);
  }
  return clean === '' ? null : clean;
}

function priceLine(catalog: ReadonlyMap<string, ProductDef>, line: CartLineInput, index: number): PricedLine {
  const qty = line.qty;
  if (!Number.isInteger(qty) || qty < 1 || qty > LIMITS.maxQty) {
    throw new PricingError('INVALID_QTY', `Adet 1-${LIMITS.maxQty} arasında olmalı`, index);
  }

  const product = catalog.get(line.productId);
  if (!product) throw new PricingError('UNKNOWN_PRODUCT', 'Ürün bulunamadı', index);
  if (!product.active || product.availability !== 'IN_STOCK') {
    throw new PricingError('PRODUCT_UNAVAILABLE', `${product.name} şu an sipariş edilemiyor`, index);
  }
  if (!isKurus(product.basePriceKurus) || product.basePriceKurus < 0) {
    throw new PricingError('INVALID_PRICE_DATA', `${product.name} fiyat verisi geçersiz`, index);
  }

  const ids = line.optionValueIds ?? [];
  if (new Set(ids).size !== ids.length) {
    throw new PricingError('DUPLICATE_OPTION', 'Aynı seçenek birden fazla gönderilemez', index);
  }

  const lookup = new Map<string, { group: OptionGroupDef; value: OptionValueDef }>();
  for (const group of product.optionGroups) {
    for (const value of group.values) lookup.set(value.id, { group, value });
  }

  const picked: PricedOption[] = [];
  const perGroup = new Map<string, number>();
  for (const id of ids) {
    const hit = lookup.get(id);
    if (!hit) throw new PricingError('UNKNOWN_OPTION', 'Seçenek bu ürüne ait değil', index);
    if (!hit.value.available) {
      throw new PricingError('UNAVAILABLE_OPTION', `${hit.value.name} şu an mevcut değil`, index);
    }
    if (!isKurus(hit.value.priceDeltaKurus)) {
      throw new PricingError('INVALID_PRICE_DATA', `${hit.value.name} fiyat verisi geçersiz`, index);
    }
    perGroup.set(hit.group.id, (perGroup.get(hit.group.id) ?? 0) + 1);
    picked.push({ optionValueId: id, name: hit.value.name, priceDeltaKurus: hit.value.priceDeltaKurus });
  }

  for (const group of product.optionGroups) {
    const count = perGroup.get(group.id) ?? 0;
    const min = group.required ? Math.max(group.minSelect, 1) : group.minSelect;
    const max = group.selection === 'SINGLE' ? 1 : group.maxSelect;
    if (count < min || count > max) {
      throw new PricingError('OPTION_RULE_VIOLATION', `${group.name}: ${min}-${max} seçim gerekli`, index);
    }
  }

  const unit = product.basePriceKurus + picked.reduce((sum, o) => sum + o.priceDeltaKurus, 0);
  if (!isKurus(unit) || unit < 0) {
    throw new PricingError('INVALID_PRICE_DATA', `${product.name} birim fiyatı geçersiz`, index);
  }
  const lineTotal = unit * qty;
  if (!isKurus(lineTotal)) throw new PricingError('INVALID_PRICE_DATA', 'Satır toplamı geçersiz', index);

  return {
    productId: product.id,
    name: product.name,
    qty,
    unitPriceKurus: unit,
    lineTotalKurus: lineTotal,
    note: normalizeNote(line.note, index),
    options: picked,
  };
}

export function priceCart(
  catalog: ReadonlyMap<string, ProductDef>,
  lines: readonly CartLineInput[],
  opts: { extraFeeKurus?: number } = {},
): Quote {
  if (lines.length === 0) throw new PricingError('EMPTY_CART', 'Sepet boş');
  if (lines.length > LIMITS.maxLines) {
    throw new PricingError('TOO_MANY_LINES', `Sipariş başına en fazla ${LIMITS.maxLines} kalem`);
  }
  const extra = opts.extraFeeKurus ?? 0;
  if (!isKurus(extra) || extra < 0) throw new PricingError('INVALID_PRICE_DATA', 'Ek ücret geçersiz');

  const priced = lines.map((line, i) => priceLine(catalog, line, i));
  const subtotal = priced.reduce((sum, l) => sum + l.lineTotalKurus, 0);
  if (!isKurus(subtotal)) throw new PricingError('INVALID_PRICE_DATA', 'Ara toplam geçersiz');

  return { lines: priced, subtotalKurus: subtotal, extraFeeKurus: extra, totalKurus: subtotal + extra };
}
