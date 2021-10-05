import {
  ChangeAddressFromAssetGetter,
  CompareUtxoFn,
  HandleCoinSelectorErrorFn,
  RecipientInterface,
  UtxoInterface,
} from '../types';

export const makeChanges = (
  changeAddressGetter: ChangeAddressFromAssetGetter
) => (toSelect: Map<string, number>) => (
  selectedUtxos: UtxoInterface[]
): RecipientInterface[] => {
  const recipients: RecipientInterface[] = [];
  toSelect.forEach((amount: number, asset: string) => {
    const changeAmount = diff(selectedUtxos)(asset)(amount);
    if (changeAmount > 0) {
      // has change
      recipients.push({
        address: changeAddressGetter(asset),
        asset,
        value: amount,
      });
    }
  });
  return recipients;
};

const diff = (utxos: UtxoInterface[]) => (asset: string) => {
  const sum = sumUtxos(asset)(utxos);
  return (amount: number) => sum - amount;
};

const sumUtxos = (asset: string) => (utxos: UtxoInterface[]): number =>
  utxos
    .filter(assetFilter(asset))
    .reduce(
      (sum: number, utxo: UtxoInterface) =>
        utxo.value ? sum + utxo.value : sum,
      0
    );

export const coinSelect = (compareFn: CompareUtxoFn) => (
  errorHandler: HandleCoinSelectorErrorFn
) => (utxos: UtxoInterface[]) => (toSelect: Map<string, number>) => {
  const selectors: ((utxos: UtxoInterface[]) => UtxoInterface[])[] = [];
  const coinSelectorFilter = coinSelectUtxosFilter(compareFn)(errorHandler);
  toSelect.forEach((amount: number, asset: string) => {
    selectors.push(coinSelectorFilter(asset)(amount));
  });
  return selectors.flatMap(fnSelect => fnSelect(utxos));
};

export function reduceRecipients(recipients: RecipientInterface[]) {
  return recipients.reduce(recipientsReducer, new Map<string, number>());
}

function recipientsReducer(
  results: Map<string, number>,
  next: RecipientInterface
) {
  results.set(next.asset, (results.get(next.asset) || 0) + next.value);
  return results;
}

const coinSelectUtxosFilter = (compareFn: CompareUtxoFn) => (
  errorHandler: HandleCoinSelectorErrorFn
) => (asset: string) => (amount: number) => (
  utxos: UtxoInterface[]
): UtxoInterface[] => {
  let amtSelected = 0;
  const selected = utxos
    .filter(assetFilter(asset))
    .sort(compareFn)
    .reduce((selected: UtxoInterface[], next: UtxoInterface) => {
      if (amtSelected <= amount && next.value) {
        selected.push(next);
        amtSelected += next.value;
      }
      return selected;
    }, []);

  // if not enougth amount is selected, use errorHandler
  if (amtSelected < amount) errorHandler(asset, amount, amtSelected);
  return selected;
};

const assetFilter = (assetToFilter: string) => ({
  asset,
}: {
  asset?: string;
}) => asset && asset === assetToFilter;
