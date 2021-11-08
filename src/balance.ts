import { asset, Output, sats } from './types';
import { groupBy } from './utils';

/**
 * reduces the set of unspents in order to compute sats grouped by assets.
 * @param unspents the utxos to reduce
 */
export function balances(unspents: Output[]): Record<string, number> {
  const unspentsByAsset = groupBy<Output>(unspents, asset);
  const balances: Record<string, number> = {};

  for (const [asset, utxos] of Object.entries(unspentsByAsset)) {
    balances[asset] = sumSats(utxos);
  }

  return balances;
}

function sumSats(unspents: Output[]): number {
  return unspents.reduce((acc, utxo) => acc + sats(utxo), 0);
}
