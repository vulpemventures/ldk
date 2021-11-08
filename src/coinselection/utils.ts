import {
  ChangeAddressFromAssetGetter,
  CoinSelectorErrorFn,
  RecipientInterface,
  UnblindedOutput,
  sats,
  asset,
} from '../types';
import { CompareUtxoFn } from './greedy';

export const throwErrorHandler: CoinSelectorErrorFn = (
  asset: string,
  need: number,
  has: number
) => {
  throw new Error(
    `not enought funds to fill ${need}sats of ${asset} (amount selected: ${has})`
  );
};

// makeChanges creates the change RecipientInterface if needed
export const makeChanges = (
  changeAddressGetter: ChangeAddressFromAssetGetter
) => (toSelect: Map<string, number>) => (
  selectedUtxos: UnblindedOutput[]
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

const diff = (utxos: UnblindedOutput[]) => (asset: string) => {
  const sum = sumUtxos(asset)(utxos);
  return (amount: number) => sum - amount;
};

const sumUtxos = (asset: string) => (utxos: UnblindedOutput[]): number =>
  utxos
    .filter(assetFilter(asset))
    .reduce((sum: number, utxo: UnblindedOutput) => sum + sats(utxo), 0);

// coinSelect is used to select utxo until they fill the amount requested
export const coinSelect = (compareFn: CompareUtxoFn) => (
  errorHandler: CoinSelectorErrorFn
) => (utxos: UnblindedOutput[]) => (toSelect: Map<string, number>) => {
  const selectors: ((utxos: UnblindedOutput[]) => UnblindedOutput[])[] = [];
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
  errorHandler: CoinSelectorErrorFn
) => (asset: string) => (amount: number) => (
  utxos: UnblindedOutput[]
): UnblindedOutput[] => {
  let amtSelected = 0;
  const selected = utxos
    .filter(assetFilter(asset))
    .sort(compareFn)
    .reduce((selected: UnblindedOutput[], next: UnblindedOutput) => {
      if (amtSelected <= amount) {
        selected.push(next);
        amtSelected += sats(next);
      }
      return selected;
    }, []);

  // if not enougth amount is selected, use errorHandler
  if (amtSelected < amount) errorHandler(asset, amount, amtSelected);
  return selected;
};

const assetFilter = (assetToFilter: string) => (u: UnblindedOutput) =>
  asset && asset(u) === assetToFilter;

export const checkCoinSelect = (recipients: RecipientInterface[]) => (
  selectedUtxos: UnblindedOutput[]
) => {
  const inputs = selectedUtxos.map(u => ({
    value: sats(u) || 0,
    asset: asset(u) || '',
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
