import {
  ChangeAddressFromAssetGetter,
  RecipientInterface,
  sats,
  UnblindedOutput,
} from './../types';
import { CoinSelectionResult, CoinSelector } from './coinSelector';

import {
  coinSelect,
  makeChanges,
  reduceRecipients,
  throwErrorHandler,
} from './utils';

export type CompareUtxoFn = (a: UnblindedOutput, b: UnblindedOutput) => number;

const defaultCompareFn: CompareUtxoFn = (
  a: UnblindedOutput,
  b: UnblindedOutput
) => sats(a) - sats(b);

/**
 * select utxo for outputs among unspents.
 * @param unspents a set of unspents.
 * @param recipients the outputs targetted by the coin selection
 */
export function greedyCoinSelector(sortFn = defaultCompareFn): CoinSelector {
  return (errorHandler = throwErrorHandler) => {
    const coinSelectFn = coinSelect(sortFn)(errorHandler);
    return (
      unspents: UnblindedOutput[],
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
