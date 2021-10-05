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
        value: changeAmount,
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

export const checkCoinSelect = (recipients: RecipientInterface[]) => (
  selectedUtxos: UtxoInterface[]
) => {
  const inputs = selectedUtxos.map(u => ({
    value: u.value || 0,
    asset: u.asset || '',
  }));
  return check(inputs)(recipients);
};

const check = (inputs: { asset: string; value: number }[]) => (
  outputs: { asset: string; value: number }[]
) => {
  const groupByAsset = groupBy<{ asset: string; value: number }, string>(
    'asset'
  );
  const inputsByAsset = groupByAsset(inputs);
  const outputsByAsset = groupByAsset(outputs);
  const inputsAssets = Object.keys(inputsByAsset).sort();
  const outputsAssets = Object.keys(outputsByAsset).sort();

  if (!inputsAssets.every((asset: string) => outputsAssets.includes(asset))) {
    throw new Error(
      `inputs and outputs don't have the same assets. Inputs assets = ${inputsAssets}, Outputs assets = ${outputsAssets}`
    );
  }

  for (const asset in inputsByAsset) {
    const sumInputs = sumNumbers(
      inputsByAsset[asset].map(({ value }) => value)
    );
    const sumOutputs = sumNumbers(
      outputsByAsset[asset].map(({ value }) => value)
    );

    if (sumInputs !== sumOutputs) {
      throw new Error(
        `missing funds for asset ${asset} (inputs: ${sumInputs}, outputs: ${sumOutputs})`
      );
    }
  }
};

const sumNumbers = (values: number[]) =>
  values.reduce(function(acc, current) {
    return acc + current;
  }, 0);

function groupBy<
  T extends Record<string, any>,
  R extends string | number | symbol
>(key: string) {
  return (xs: T[]): Record<R, T[]> => {
    return xs.reduce(function(rv: Record<any, T[]>, x: T) {
      (rv[x[key]] = rv[x[key]] || []).push(x);
      return rv;
    }, {});
  };
}
