import { pgTable, text, real, timestamp } from 'drizzle-orm/pg-core';

export const ordersTable = pgTable('orders', {
  id: text('id').primaryKey(),
  tableName: text('table_name').notNull(),
  status: text('status').notNull(),
  items: text('items').notNull(),
  totalPrice: real('total_price').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at'),
});
