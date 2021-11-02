import {
  UtxoInterface,
  RecipientInterface,
  ChangeAddressFromAssetGetter,
  CoinSelectorErrorFn,
} from './../types';

export interface CoinSelectionResult {
  selectedUtxos: UtxoInterface[];
  changeOutputs: RecipientInterface[];
}

export type CoinSelector = (
  errorHandler: CoinSelectorErrorFn
) => (
  unspents: UtxoInterface[],
  outputs: RecipientInterface[],
  changeGetter: ChangeAddressFromAssetGetter
) => CoinSelectionResult;
