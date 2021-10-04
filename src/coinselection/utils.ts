import { UtxoInterface } from '../types';

const select = (asset: string) => (amount: number) => (
  utxos: UtxoInterface[]
): UtxoInterface[] => {
  let amountToSelect = amount;
  return utxos.filter(assetFilter(asset)).reduce((selected, utxo, index) => {
    if (sumUtxos(selected) >= amount) return selected;
    else selected.concat([utxo]);
  }, []);
};

const sumUtxos = (utxos: UtxoInterface[]): number =>
  utxos.reduce(
    (sum: number, utxo: UtxoInterface) => (utxo.value ? sum + utxo.value : sum),
    0
  );

const assetFilter = (assetToFilter: string) => ({
  asset,
}: {
  asset?: string;
}) => asset && asset === assetToFilter;
