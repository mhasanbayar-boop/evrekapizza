import express from 'express';
import type { Request, Response } from 'express';
import crypto from 'crypto';

const app = express();
app.use(express.json());

// Statik dosyaları (index.html, admin.html) dışa açmak için:
app.use(express.static('public'));

// Sunucu tarafında tutulan güvenli admin şifresi / hash
const ADMIN_PASSWORD_HASH = crypto.createHash('sha256').update('1234').digest('hex');

// Bellek içi sipariş veritabanı
let ordersDb: any[] = [];

// ==================== AUTH ENDPOINT ====================
app.post('/api/auth/login', (req: Request, res: Response) => {
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
app.post('/api/orders', (req: Request, res: Response) => {
  const { tableName, items, totalPrice } = req.body;

  if (!tableName || !items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Geçersiz sipariş verisi!' });
  }

  const newOrder = {
    id: 'EVR-' + Math.floor(100000 + Math.random() * 900000),
    tableName,
    status: 'WAITING_WAITER',
    items,
    totalPrice,
    createdAt: new Date().toISOString()
  };

  ordersDb.unshift(newOrder);
  return res.status(201).json({ success: true, order: newOrder });
});

app.get('/api/orders', (req: Request, res: Response) => {
  return res.json({ success: true, orders: ordersDb });
});

app.patch('/api/orders/:id/approve', (req: Request, res: Response) => {
  const { id } = req.params;
  const order = ordersDb.find(o => o.id === id);

  if (!order) return res.status(404).json({ error: 'Sipariş bulunamadı.' });
  if (order.status !== 'WAITING_WAITER') {
    return res.status(400).json({ error: 'Sipariş zaten onaylanmış veya iptal edilmiş.' });
  }

  order.status = 'PREPARING';
  order.updatedAt = new Date().toISOString();

  return res.json({ success: true, order });
});

app.delete('/api/orders/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const orderIndex = ordersDb.findIndex(o => o.id === id);

  if (orderIndex === -1) return res.status(404).json({ error: 'Sipariş bulunamadı.' });

  ordersDb[orderIndex].status = 'CANCELLED';
  return res.json({ success: true, message: 'Sipariş iptal edildi.' });
});

app.listen(3000, () => console.log('Evreka Pizza API http://localhost:3000 adresinde çalışıyor.'));