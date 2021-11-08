import {
  asset,
  ChangeAddressFromAssetGetter,
  RecipientInterface,
  sats,
  UnblindedOutput,
} from './../types';
import { CoinSelectionResult, CoinSelector } from './coinSelector';

export type CompareUtxoFn = (a: UnblindedOutput, b: UnblindedOutput) => number;

const defaultCompareFn: CompareUtxoFn = (
  a: UnblindedOutput,
  b: UnblindedOutput
) => sats(a) - sats(b);

// the exported factory function for greedy coin selector
export function greedyCoinSelector(
  compare: CompareUtxoFn = defaultCompareFn
): CoinSelector {
  return (
    u: UnblindedOutput[],
    o: RecipientInterface[],
    getter: ChangeAddressFromAssetGetter
  ) => greedyCoinSelection(u, o, getter, compare);
}

/**
 * select utxo for outputs among unspents.
 * @param unspents a set of unspents.
 * @param recipients the outputs targetted by the coin selection
 */
function greedyCoinSelection(
  unspents: UnblindedOutput[],
  recipients: RecipientInterface[],
  changeAddressGetter: ChangeAddressFromAssetGetter,
  sortFn: CompareUtxoFn
): CoinSelectionResult {
  const result: CoinSelectionResult = {
    selectedUtxos: [],
    changeOutputs: [],
  };

  const utxosGroupedByAsset = groupBy<UnblindedOutput>(unspents, u => asset(u));
  const outputsGroupedByAsset = groupBy<RecipientInterface>(
    recipients,
    r => r.asset
  );

  for (const [asset, outputs] of Object.entries(outputsGroupedByAsset)) {
    const unspents = utxosGroupedByAsset[asset];
    if (!unspents) {
      throw new Error('need unspents for the asset: ' + asset);
    }

    const targetAmount: number = outputs.reduce(
      (acc: number, output: RecipientInterface) => acc + output.value,
      0
    );

    const { selected, changeAmount } = selectUtxos(
      unspents,
      targetAmount,
      sortFn
    );

    result.selectedUtxos.push(...selected);

    if (changeAmount > 0) {
      const changeAddr = changeAddressGetter(asset);
      if (!changeAddr) {
        throw new Error('need change address for asset: ' + asset);
      }

      result.changeOutputs.push({
        asset: asset,
        value: changeAmount,
        address: changeAddr,
      });
    }
  }

  return result;
}

function selectUtxos(
  utxos: UnblindedOutput[],
  targetAmount: number,
  compareFn: CompareUtxoFn
): {
  selected: UnblindedOutput[];
  changeAmount: number;
} {
  utxos = utxos.sort(compareFn);
  const selected: UnblindedOutput[] = [];
  let total = 0;
  for (const utxo of utxos) {
    selected.push(utxo);
    total += sats(utxo);

    if (total >= targetAmount) {
      return {
        selected,
        changeAmount: total - targetAmount,
      };
    }
  }

  throw new Error('not enough utxos in wallet to fund: ' + targetAmount);
}

function groupBy<T extends Record<string, any>>(
  xs: T[],
  key: (t: T) => string
): Record<string, T[]> {
  return xs.reduce(function(rv, x) {
    (rv[key(x)] = rv[key(x)] || []).push(x);
    return rv;
  }, {} as Record<string, T[]>);
}
