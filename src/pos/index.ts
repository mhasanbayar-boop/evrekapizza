import { DisabledPosAdapter, type PosPort } from './pos-port.ts';
import { ElektraWebPosAdapter } from './elektraweb-adapter.ts';

export * from './pos-port.ts';
export * from './dispatcher.ts';
export { ElektraWebPosAdapter } from './elektraweb-adapter.ts';

/**
 * Ortam değişkenlerinden adapter seçer. Varsayılan KAPALIDIR.
 * Kimlik bilgileri yalnızca API/worker ortamında okunur; istemciye (NEXT_PUBLIC_*) asla geçmez.
 */
export function createPosAdapter(env: Record<string, string | undefined>): PosPort {
  if (env.POS_INTEGRATION_ENABLED !== 'true') return new DisabledPosAdapter();
  if (env.POS_PROVIDER === 'elektraweb') return new ElektraWebPosAdapter();
  throw new Error(`POS_INTEGRATION_ENABLED=true ancak POS_PROVIDER geçersiz: ${env.POS_PROVIDER ?? '(boş)'}`);
}
