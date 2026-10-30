import type { Bundle, OrderResponse } from '../types/api.ts';
import { ApiError, validateBundle, validateOrderResponse } from './validation.ts';
export { ApiError, validateBundle } from './validation.ts';

async function getJson(path: string, signal: AbortSignal | undefined, fetcher: typeof fetch): Promise<unknown> {
  let response: Response;
  try { response = await fetcher(`/api/v1/${path}`, { signal }); }
  catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError('offline', 'Não foi possível conectar à API local.');
  }
  if (!response.ok) throw new ApiError('http', `A API respondeu HTTP ${response.status}.`);
  try { return await response.json() as unknown; }
  catch { throw new ApiError('schema', 'A API não retornou JSON válido.'); }
}

export async function loadBundle(signal?: AbortSignal, fetcher: typeof fetch = fetch): Promise<Bundle> {
  const [replay, overview, orders, diagnostics] = await Promise.all(
    ['replay', 'overview', 'orders', 'diagnostics'].map(path => getJson(path, signal, fetcher)));
  return validateBundle({ replay, overview, orders, diagnostics });
}

/** Consulta individual sem colocar o ID num segmento de caminho ou perder UTF-16. */
export async function loadOrder(id: string, signal?: AbortSignal, fetcher: typeof fetch = fetch, snapshotId?: string): Promise<OrderResponse> {
  const query = new URLSearchParams({ order_id_json: JSON.stringify(id) });
  return validateOrderResponse(await getJson(`order?${query}`, signal, fetcher), id, snapshotId);
}
