// The petrol price for ev8.ge's calculator: read from the chains' boards,
// kept as one median, and never replaced by a reading that did not work.
// The page below is written here in the shape of the source page (a table
// per chain, the price in data-std beside the octane); no network is used.
import { describe, expect, it } from 'vitest';
import { median, regularPrices, setFuelFetchForTests } from '../src/lib/fuelPrice.js';
import { HAS_DB, getApp, json } from './helpers.js';

const row = (name: string, octane: string, price: string) =>
  `<tr> <td>${name}</td> <td>${octane}</td> <td class="fuel-price-cell" data-std="${price}" data-self=""> <span class="price-val">${price}</span> </td> </tr>`;
const table = (...rows: string[]) => `<table> <tbody> <tr> <th>type</th> <th>octane</th> <th>price</th> </tr> ${rows.join(' ')} </tbody> </table>`;

const BOARD = [
  table(row('Super A', '98', '4.62'), row('Premium A', '95', '4.31'), row('Euro regular A', '92/93', '4.02'), row('Diesel A', '53', '4.96')),
  // Two rows of the same regular price, as one chain lists them: counted once.
  table(row('Super B', '98', '4.65'), row('Brand regular B', '92', '4.03'), row('Euro regular B', '92', '4.03')),
  table(row('Premium C', '95', '4.32'), row('Euro regular C', '92', '4.08')),
  table(row('Euro regular D', '92', '3.95')),
  // A table with no regular petrol at all says nothing.
  table(row('Gas', '-', '1.64')),
].join('\n');

describe('reading the boards', () => {
  it('takes one regular price per chain, in tetri', () => {
    expect(regularPrices(BOARD)).toEqual([402, 403, 408, 395]);
  });

  it('keeps the middle of them', () => {
    expect(median([402, 403, 408, 395])).toBe(403);
    expect(median([402, 408, 395])).toBe(402);
  });

  it('finds nothing on a page of another shape', () => {
    expect(regularPrices('<html><body>maintenance</body></html>')).toEqual([]);
  });
});

describe.skipIf(!HAS_DB)('the daily reading, end to end', () => {
  const job = async () => {
    const app = await getApp();
    const { env } = await import('../src/lib/env.js');
    return app.inject({ method: 'POST', url: '/api/jobs/fuel-price', headers: { 'x-worker-token': env.WORKER_TOKEN } });
  };
  const price = async () => (await getApp()).inject({ method: 'GET', url: '/api/site/fuel' });

  it('only the worker may ask for a reading', async () => {
    const app = await getApp();
    expect((await app.inject({ method: 'POST', url: '/api/jobs/fuel-price' })).statusCode).toBe(401);
  });

  it('keeps the median, serves it to the site, and keeps it through a failed reading', async () => {
    setFuelFetchForTests(async () => ({ ok: true, status: 200, text: async () => BOARD }));
    expect(json(await job())).toEqual({ status: 'ok', perLitreTetri: 403, chains: 4 });

    const first = await price();
    expect(first.statusCode).toBe(200);
    const served = json<{ perLitreTetri: number; asOf: string; chains: number; grade: string }>(first);
    expect(served).toMatchObject({ perLitreTetri: 403, chains: 4, grade: 'regular' });

    // The page changed shape: nothing replaces the price that was read.
    setFuelFetchForTests(async () => ({ ok: true, status: 200, text: async () => table(row('Euro regular', '92', '4.00')) }));
    expect(json<{ status: string }>(await job()).status).toBe('failed');
    expect(json(await price())).toEqual(served);

    // The page did not answer: the same.
    setFuelFetchForTests(async () => ({ ok: false, status: 503, text: async () => '' }));
    expect(json(await job())).toMatchObject({ status: 'failed', httpStatus: 503 });
    expect(json(await price())).toEqual(served);

    // A price nobody would believe is not a price.
    setFuelFetchForTests(async () => ({
      ok: true,
      status: 200,
      text: async () => [table(row('a', '92', '0.40')), table(row('b', '92', '40.00')), table(row('c', '92', '4.00'))].join(''),
    }));
    expect(json<{ status: string }>(await job()).status).toBe('failed');
    expect(json(await price())).toEqual(served);
  });
});
