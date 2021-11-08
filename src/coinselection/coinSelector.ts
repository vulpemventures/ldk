import {
  RecipientInterface,
  ChangeAddressFromAssetGetter,
  UnblindedOutput,
} from './../types';

export interface CoinSelectionResult {
  selectedUtxos: UnblindedOutput[];
  changeOutputs: RecipientInterface[];
}

export type CoinSelector = (
  unspents: UnblindedOutput[],
  outputs: RecipientInterface[],
  changeGetter: ChangeAddressFromAssetGetter
) => CoinSelectionResult;
