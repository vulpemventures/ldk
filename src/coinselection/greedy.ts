import {
  ChangeAddressFromAssetGetter,
  RecipientInterface,
  UtxoInterface,
} from './../types';
import { CoinSelectionResult, CoinSelector } from './coinSelector';

export type CompareUtxoFn = (a: UtxoInterface, b: UtxoInterface) => number;

const defaultCompareFn: CompareUtxoFn = (a: UtxoInterface, b: UtxoInterface) =>
  a.value - b.value;

// the exported factory function for greedy coin selector
export function greedyCoinSelector(
  compare: CompareUtxoFn = defaultCompareFn
): CoinSelector {
  return (
    u: UtxoInterface[],
    o: RecipientInterface[],
    getter: ChangeAddressFromAssetGetter
  ) => greedyCoinSelection(u, o, getter, compare);
}

/**
 * select utxo for outputs among unspents.
 * @param unspents a set of unspents.
 * @param outputs the outputs targetted by the coin selection
 */
function greedyCoinSelection(
  unspents: UtxoInterface[],
  outputs: RecipientInterface[],
  changeAddressGetter: ChangeAddressFromAssetGetter,
  sortFn: CompareUtxoFn
): CoinSelectionResult {
  const result: CoinSelectionResult = {
    selectedUtxos: [],
    changeOutputs: [],
  };

  const utxosGroupedByAsset = groupBy(unspents, 'asset') as Record<
    string,
    UtxoInterface[]
  >;
  const outputsGroupedByAsset = groupBy(outputs, 'asset') as Record<
    string,
    RecipientInterface[]
  >;

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
  utxos: UtxoInterface[],
  targetAmount: number,
  compareFn: CompareUtxoFn
): {
  selected: UtxoInterface[];
  changeAmount: number;
} {
  utxos = utxos.sort(compareFn);
  const selected: UtxoInterface[] = [];
  let total = 0;
  for (const utxo of utxos) {
    selected.push(utxo);
    total += utxo.value;

    if (total >= targetAmount) {
      return {
        selected,
        changeAmount: total - targetAmount,
      };
    }
  }

  throw new Error('not enough utxos in wallet to found: ' + targetAmount);
}

function groupBy(xs: Array<any>, key: string) {
  return xs.reduce(function(rv, x) {
    (rv[x[key]] = rv[x[key]] || []).push(x);
    return rv;
  }, {});
}
