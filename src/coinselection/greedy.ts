import {
  ChangeAddressFromAssetGetter,
  RecipientInterface,
  UtxoInterface,
  CompareUtxoFn,
} from './../types';
import { CoinSelectionResult, CoinSelector } from './coinSelector';
import {
  coinSelect,
  makeChanges,
  reduceRecipients,
  throwErrorHandler,
} from './utils';

const defaultCompareFn: CompareUtxoFn = (a: UtxoInterface, b: UtxoInterface) =>
  a.value! - b.value!;

/**
 * select utxo for outputs among unspents.
 * @param unspents a set of unspents.
 * @param outputs the outputs targetted by the coin selection
 */
export function greedyCoinSelector(sortFn = defaultCompareFn): CoinSelector {
  return (errorHandler = throwErrorHandler) => {
    const coinSelectFn = coinSelect(sortFn)(errorHandler);
    return (
      unspents: UtxoInterface[],
      recipients: RecipientInterface[],
      changeAddressGetter: ChangeAddressFromAssetGetter
    ): CoinSelectionResult => {
      const makeChangesFn = makeChanges(changeAddressGetter);
      const recipientsMap = reduceRecipients(recipients);
      const selectedUtxos = coinSelectFn(unspents)(recipientsMap);
      const changeOutputs = makeChangesFn(recipientsMap)(selectedUtxos);

      return {
        selectedUtxos,
        changeOutputs,
      };
    };
  };
}
