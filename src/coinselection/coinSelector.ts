import {
  RecipientInterface,
  ChangeAddressFromAssetGetter,
  UnblindedOutput,
  CoinSelectorErrorFn,
} from './../types';

export interface CoinSelectionResult {
  selectedUtxos: UnblindedOutput[];
  changeOutputs: RecipientInterface[];
}

export type CoinSelector = (
  errorHandler: CoinSelectorErrorFn
) => (
  unspents: UnblindedOutput[],
  outputs: RecipientInterface[],
  changeGetter: ChangeAddressFromAssetGetter
) => CoinSelectionResult;
