import express from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const app = express();
app.use(express.json());

// Statik frontend dosyalarını dışa aç (public klasörü kök dizinde olmalı)
app.use(express.static(path.join(process.cwd(), 'public')));

// Admin şifre hash'i (1234)
const ADMIN_PASSWORD_HASH = crypto.createHash('sha256').update('1234').digest('hex');

// Kök dizinde orders.json kullanarak ciro ve siparişlerin asla sıfırlanmamasını sağla
const DATA_FILE = path.join(process.cwd(), 'orders.json');

function loadOrders() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = fs.readFileSync(DATA_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error('Veri okuma hatası:', err);
  }
  return [];
}

function saveOrders(orders: any) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(orders, null, 2), 'utf8');
  } catch (err) {
    console.error('Veri kaydetme hatası:', err);
  }
}

let ordersDb = loadOrders();

// ==================== AUTH ====================
app.post('/api/auth/login', (req: any, res: any) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'Şifre gereklidir.' });

  const inputHash = crypto.createHash('sha256').update(password).digest('hex');
  if (inputHash === ADMIN_PASSWORD_HASH) {
    const sessionToken = crypto.randomBytes(32).toString('hex');
    return res.json({ success: true, token: sessionToken });
  }

  return res.status(401).json({ error: 'Geçersiz yönetici şifresi!' });
});

// ==================== ORDERS API ====================
app.post('/api/orders', (req: any, res: any) => {
  const { tableName, items, totalPrice } = req.body;

  if (!tableName || !items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Geçersiz sipariş verisi!' });
  }

  const newOrder = {
    id: 'EVR-' + Math.floor(100000 + Math.random() * 900000),
    tableName,
    status: 'WAITING_WAITER', // WAITING_WAITER -> PREPARING -> SERVED -> PAID
    items,
    totalPrice,
    createdAt: new Date().toISOString()
  };

  ordersDb.unshift(newOrder);
  saveOrders(ordersDb);
  return res.status(201).json({ success: true, order: newOrder });
});

app.get('/api/orders', (req: any, res: any) => {
  return res.json({ success: true, orders: ordersDb });
});

// Mutfağa Gönder
app.patch('/api/orders/:id/approve', (req: any, res: any) => {
  const { id } = req.params;
  const order = ordersDb.find((o: any) => o.id === id);

  if (!order) return res.status(404).json({ error: 'Sipariş bulunamadı.' });

  order.status = 'PREPARING';
  order.updatedAt = new Date().toISOString();
  saveOrders(ordersDb);

  return res.json({ success: true, order });
});

// Masaya Servis Edildi (3. Aşama - Mor Yanma Garantili)
app.patch('/api/orders/:id/serve', (req: any, res: any) => {
  const { id } = req.params;
  const order = ordersDb.find((o: any) => o.id === id);

  if (!order) return res.status(404).json({ error: 'Sipariş bulunamadı.' });

  order.status = 'SERVED';
  order.updatedAt = new Date().toISOString();
  saveOrders(ordersDb);

  return res.json({ success: true, order });
});

// Ödeme Alındı
app.patch('/api/orders/:id/pay', (req: any, res: any) => {
  const { id } = req.params;
  const order = ordersDb.find((o: any) => o.id === id);

  if (!order) return res.status(404).json({ error: 'Sipariş bulunamadı.' });

  order.status = 'PAID';
  order.updatedAt = new Date().toISOString();
  saveOrders(ordersDb);

  return res.json({ success: true, order });
});

// Genel Durum Güncelleme
app.patch('/api/orders/:id/status', (req: any, res: any) => {
  const { id } = req.params;
  const { status } = req.body;
  const order = ordersDb.find((o: any) => o.id === id);

  if (!order) return res.status(404).json({ error: 'Sipariş bulunamadı.' });
  if (!status) return res.status(400).json({ error: 'Durum gereklidir.' });

  order.status = String(status).toUpperCase().trim();
  order.updatedAt = new Date().toISOString();
  saveOrders(ordersDb);

  return res.json({ success: true, order });
});

app.delete('/api/orders/:id', (req: any, res: any) => {
  const { id } = req.params;
  const orderIndex = ordersDb.findIndex((o: any) => o.id === id);

  if (orderIndex === -1) return res.status(404).json({ error: 'Sipariş bulunamadı.' });

  ordersDb[orderIndex].status = 'CANCELLED';
  ordersDb[orderIndex].updatedAt = new Date().toISOString();
  saveOrders(ordersDb);

  return res.json({ success: true, message: 'Sipariş iptal edildi.' });
});

const PORT = process.env.PORT || 3000;
app.listen(Number(PORT), '0.0.0.0', () => {
  console.log(`Evreka Pizza API ${PORT} portunda başarıyla çalışıyor.`);
});
