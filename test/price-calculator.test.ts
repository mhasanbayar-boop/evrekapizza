import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PricingError,
  priceCart,
  type CartLineInput,
  type OptionGroupDef,
  type ProductDef,
} from '../src/pricing/price-calculator.ts';

const size: OptionGroupDef = {
  id: 'g-size',
  name: 'Boyut',
  selection: 'SINGLE',
  minSelect: 1,
  maxSelect: 1,
  required: true,
  values: [
    { id: 'v-small', name: 'Küçük', priceDeltaKurus: 0, available: true },
    { id: 'v-medium', name: 'Orta', priceDeltaKurus: 5000, available: true },
    { id: 'v-large', name: 'Büyük', priceDeltaKurus: 10000, available: true },
  ],
};

const crust: OptionGroupDef = {
  id: 'g-crust',
  name: 'Kenar',
  selection: 'SINGLE',
  minSelect: 0,
  maxSelect: 1,
  required: false,
  values: [
    { id: 'v-cheese-crust', name: 'Peynirli kenar', priceDeltaKurus: 3000, available: true },
    { id: 'v-garlic-crust', name: 'Sarımsaklı kenar', priceDeltaKurus: 2000, available: true },
  ],
};

const extras: OptionGroupDef = {
  id: 'g-extra',
  name: 'Ekstra malzeme',
  selection: 'MULTI',
  minSelect: 0,
  maxSelect: 3,
  required: false,
  values: [
    { id: 'v-mushroom', name: 'Mantar', priceDeltaKurus: 2000, available: true },
    { id: 'v-sucuk', name: 'Sucuk', priceDeltaKurus: 3000, available: true },
    { id: 'v-olive', name: 'Zeytin', priceDeltaKurus: 1500, available: true },
    { id: 'v-corn', name: 'Mısır', priceDeltaKurus: 1500, available: true },
    { id: 'v-jalapeno', name: 'Jalapeno', priceDeltaKurus: 1500, available: false },
  ],
};

const sucuklu: ProductDef = {
  id: 'p-sucuklu',
  name: 'Sucuklu Pizza',
  basePriceKurus: 20000,
  availability: 'IN_STOCK',
  active: true,
  optionGroups: [size, crust, extras],
};
const kola: ProductDef = {
  id: 'p-kola',
  name: 'Kola',
  basePriceKurus: 5000,
  availability: 'IN_STOCK',
  active: true,
  optionGroups: [],
};
const tiramisu: ProductDef = {
  id: 'p-tiramisu',
  name: 'Tiramisu',
  basePriceKurus: 10000,
  availability: 'IN_STOCK',
  active: true,
  optionGroups: [],
};
const bitti: ProductDef = {
  id: 'p-bitti',
  name: 'Karışık Pizza',
  basePriceKurus: 22000,
  availability: 'SOLD_OUT',
  active: true,
  optionGroups: [],
};

const catalog = new Map<string, ProductDef>(
  [sucuklu, kola, tiramisu, bitti].map((p): [string, ProductDef] => [p.id, p]),
);

function rejectsWith(code: string, fn: () => unknown): void {
  assert.throws(fn, (e: unknown) => e instanceof PricingError && e.code === code, code);
}

const kolaLine: CartLineInput = { productId: 'p-kola', optionValueIds: [], qty: 1 };

test('tasarım dokümanındaki örnek sipariş: 850 TL', () => {
  const q = priceCart(catalog, [
    {
      productId: 'p-sucuklu',
      optionValueIds: ['v-large', 'v-cheese-crust', 'v-mushroom'],
      qty: 2,
      note: 'Pizza iyi pişsin.',
    },
    kolaLine,
    { productId: 'p-tiramisu', optionValueIds: [], qty: 1 },
  ]);
  assert.equal(q.lines[0].unitPriceKurus, 35000);
  assert.equal(q.lines[0].lineTotalKurus, 70000);
  assert.equal(q.lines[0].note, 'Pizza iyi pişsin.');
  assert.equal(q.subtotalKurus, 85000);
  assert.equal(q.totalKurus, 85000);
});

test('istemci fiyat göndermeye çalışsa bile katalog fiyatı geçerlidir', () => {
  const hostile = { ...kolaLine, priceKurus: 1, unitPriceKurus: 1, totalKurus: 1 } as unknown as CartLineInput;
  assert.equal(priceCart(catalog, [hostile]).totalKurus, 5000);
});

test('ek ücret toplama eklenir', () => {
  const q = priceCart(catalog, [kolaLine], { extraFeeKurus: 1000 });
  assert.equal(q.subtotalKurus, 5000);
  assert.equal(q.totalKurus, 6000);
  rejectsWith('INVALID_PRICE_DATA', () => priceCart(catalog, [kolaLine], { extraFeeKurus: -1 }));
});

test('tükendi, bilinmeyen ve pasif ürün reddedilir', () => {
  rejectsWith('PRODUCT_UNAVAILABLE', () =>
    priceCart(catalog, [{ productId: 'p-bitti', optionValueIds: [], qty: 1 }]),
  );
  rejectsWith('UNKNOWN_PRODUCT', () => priceCart(catalog, [{ productId: 'yok', optionValueIds: [], qty: 1 }]));
  const pasif = new Map(catalog).set('p-kola', { ...kola, active: false });
  rejectsWith('PRODUCT_UNAVAILABLE', () => priceCart(pasif, [kolaLine]));
});

test('zorunlu boyut seçilmezse reddedilir', () => {
  rejectsWith('OPTION_RULE_VIOLATION', () =>
    priceCart(catalog, [{ productId: 'p-sucuklu', optionValueIds: [], qty: 1 }]),
  );
});

test('tekli grupta iki seçim reddedilir', () => {
  rejectsWith('OPTION_RULE_VIOLATION', () =>
    priceCart(catalog, [{ productId: 'p-sucuklu', optionValueIds: ['v-small', 'v-large'], qty: 1 }]),
  );
});

test('çoklu grupta üst sınır aşılamaz', () => {
  rejectsWith('OPTION_RULE_VIOLATION', () =>
    priceCart(catalog, [
      {
        productId: 'p-sucuklu',
        optionValueIds: ['v-large', 'v-mushroom', 'v-sucuk', 'v-olive', 'v-corn'],
        qty: 1,
      },
    ]),
  );
});

test('başka ürünün seçeneği, mevcut olmayan seçenek ve tekrar reddedilir', () => {
  rejectsWith('UNKNOWN_OPTION', () => priceCart(catalog, [{ productId: 'p-kola', optionValueIds: ['v-large'], qty: 1 }]));
  rejectsWith('UNAVAILABLE_OPTION', () =>
    priceCart(catalog, [{ productId: 'p-sucuklu', optionValueIds: ['v-large', 'v-jalapeno'], qty: 1 }]),
  );
  rejectsWith('DUPLICATE_OPTION', () =>
    priceCart(catalog, [{ productId: 'p-sucuklu', optionValueIds: ['v-large', 'v-large'], qty: 1 }]),
  );
});

test('adet sınırları', () => {
  for (const qty of [0, -1, 51, 1.5, Number.NaN]) {
    rejectsWith('INVALID_QTY', () => priceCart(catalog, [{ ...kolaLine, qty }]));
  }
  assert.equal(priceCart(catalog, [{ ...kolaLine, qty: 50 }]).totalKurus, 250000);
});

test('boş sepet ve 50 kalem sınırı', () => {
  rejectsWith('EMPTY_CART', () => priceCart(catalog, []));
  const lines = Array.from({ length: 51 }, () => kolaLine);
  rejectsWith('TOO_MANY_LINES', () => priceCart(catalog, lines));
  assert.equal(priceCart(catalog, lines.slice(0, 50)).totalKurus, 250000);
});

test('not: 200 karakter sınırı, kontrol karakterleri temizlenir, boş not null olur', () => {
  rejectsWith('NOTE_TOO_LONG', () => priceCart(catalog, [{ ...kolaLine, note: 'a'.repeat(201) }]));
  assert.equal(priceCart(catalog, [{ ...kolaLine, note: 'a'.repeat(200) }]).lines[0].note?.length, 200);
  assert.equal(priceCart(catalog, [{ ...kolaLine, note: 'Acısız\u0000 olsun\n' }]).lines[0].note, 'Acısız  olsun');
  assert.equal(priceCart(catalog, [{ ...kolaLine, note: '   ' }]).lines[0].note, null);
  const bad = { ...kolaLine, note: 42 } as unknown as CartLineInput;
  rejectsWith('INVALID_NOTE', () => priceCart(catalog, [bad]));
});

test('hatalı katalog verisi (negatif birim fiyat, kesirli fiyat) reddedilir', () => {
  const ucuz: ProductDef = {
    id: 'p-ucuz',
    name: 'Hatalı Ürün',
    basePriceKurus: 1000,
    availability: 'IN_STOCK',
    active: true,
    optionGroups: [
      {
        id: 'g-x',
        name: 'X',
        selection: 'SINGLE',
        minSelect: 0,
        maxSelect: 1,
        required: false,
        values: [{ id: 'v-x', name: 'İndirim', priceDeltaKurus: -2000, available: true }],
      },
    ],
  };
  const kesirli: ProductDef = { ...kola, id: 'p-kesirli', basePriceKurus: 10.5 };
  const c = new Map<string, ProductDef>([
    ['p-ucuz', ucuz],
    ['p-kesirli', kesirli],
  ]);
  rejectsWith('INVALID_PRICE_DATA', () => priceCart(c, [{ productId: 'p-ucuz', optionValueIds: ['v-x'], qty: 1 }]));
  rejectsWith('INVALID_PRICE_DATA', () => priceCart(c, [{ productId: 'p-kesirli', optionValueIds: [], qty: 1 }]));
});
