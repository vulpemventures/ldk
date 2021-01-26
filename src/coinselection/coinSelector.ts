import { UtxoInterface, RecipientInterface } from './../types';

export interface CoinSelectionResult {
  selectedUtxos: UtxoInterface[];
  changeOutputs: RecipientInterface[];
}

export type CoinSelector = (
  unspents: UtxoInterface[],
  outputs: RecipientInterface[]
) => CoinSelectionResult;
