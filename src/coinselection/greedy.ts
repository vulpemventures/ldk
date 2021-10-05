import {
  ChangeAddressFromAssetGetter,
  RecipientInterface,
  UtxoInterface,
  CompareUtxoFn,
  HandleCoinSelectorErrorFn,
} from './../types';
import { CoinSelectionResult, CoinSelector } from './coinSelector';
import { coinSelect, makeChanges, reduceRecipients } from './utils';

const defaultCompareFn: CompareUtxoFn = (a: UtxoInterface, b: UtxoInterface) =>
  a.value! - b.value!;

// the exported factory function for greedy coin selector
export function greedyCoinSelector(
  compare: CompareUtxoFn = defaultCompareFn
): CoinSelector {
  const errorHandler = (asset: string) => {
    throw new Error(`coin selector error: ${asset}`);
  };
  return greedyCoinSelection(compare)(errorHandler);
}

/**
 * select utxo for outputs among unspents.
 * @param unspents a set of unspents.
 * @param outputs the outputs targetted by the coin selection
 */
const greedyCoinSelection = (sortFn: CompareUtxoFn) => (
  errorHandler: HandleCoinSelectorErrorFn
) => (
  unspents: UtxoInterface[],
  recipients: RecipientInterface[],
  changeAddressGetter: ChangeAddressFromAssetGetter
): CoinSelectionResult => {
  const coinSelectFn = coinSelect(sortFn)(errorHandler)(unspents);
  const makeChangesFn = makeChanges(changeAddressGetter);

  const recipientsMap = reduceRecipients(recipients);
  const selectedUtxos = coinSelectFn(recipientsMap);

  return {
    selectedUtxos,
    changeOutputs: makeChangesFn(recipientsMap)(selectedUtxos),
  };
};
