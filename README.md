# QR Sipariş — Faz 0 çekirdek

Bu pakette yalnızca iş mantığının güvenlik açısından kritik çekirdeği var.
Henüz web arayüzü, API, veritabanı ve gerçek POS entegrasyonu YOK. Tasarım dokümanındaki Faz 0'dır.

## İçerik
- `src/shared/order-state.ts`: sipariş durum makinesi (kim hangi durumdan hangisine geçebilir)
- `src/pricing/price-calculator.ts`: sunucu tarafı fiyat hesabı; istemciden fiyat alınmaz, seçenek kuralları ve tükendi durumu denetlenir
- `src/security/qr-token.ts`: tek kullanımlık, kısa ömürlü, yenilenen sipariş QR token'ı (veritabanında yalnızca SHA-256 hash)
- `src/pos/`: POS arayüzü, kapalı adapter (varsayılan), ElektraWeb iskeleti ve çift gönderimi önleyen dispatcher

## Çalıştırma
Node 22.18 veya üstü gerekir. Test için bağımlılık kurmaya gerek yok:

    npm test

Tip denetimi için:

    npm install
    npm run typecheck

## ElektraWeb
Resmi, herkese açık bir sipariş API dokümanı doğrulanamadı. `ElektraWebPosAdapter` bilerek boştur ve
`NOT_CONFIGURED` döner; uç nokta, alan adı veya yetkilendirme uydurulmamıştır.
`.env.example` içindeki `ELEKTRAWEB_*` adları yer tutucudur.
POS entegrasyonu `POS_INTEGRATION_ENABLED=false` ile kapalı başlar.

## Üretime geçmeden önce
- `QrTokenStore` ve `TransferStore` için PostgreSQL (Prisma) uygulamaları yazılmalı. Tek kullanımlık tüketme
  tek bir atomik UPDATE olmalı (SQL, `qr-token.ts` içindeki yorumda).
- Kampanya fiyatlandırması henüz fiyat hesabında yok.
- Sonraki adım: tasarım dokümanındaki Faz 1 (monorepo iskeleti, Prisma şeması, kimlik/RBAC, menü CRUD).
