CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  table_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'WAITING_WAITER', -- WAITING_WAITER, PREPARING, CANCELLED, FAILED, COMPLETED
  total_price REAL NOT NULL,
  items_json TEXT NOT NULL,                      -- Sipariş kalemleri, boyutlar, ekstralar (JSON STRING)
  qr_token_hash TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);