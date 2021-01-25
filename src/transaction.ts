import { Psbt, networks, address as laddress } from 'liquidjs-lib';
import { estimateTxSize, UtxoInterface } from './wallet';

export interface RecipientInterface {
  value: number;
  asset: string;
  address: string;
}

export interface CoinSelectionResult {
  selectedUtxos: UtxoInterface[];
  changeOutputs: RecipientInterface[];
}

// define a type using to implement change's address strategy
type ChangeAddressFromAssetGetter = (asset: string) => string | undefined;

/**
 * buildTx selects utxos among unspents to fill outputs' requirements,
 * then it adds the associated inputs and outputs to the tx.
 * finally it returns the new pset base64 encoded.
 * @param psetBase64
 * @param unspents
 * @param outputs
 * @param changeScriptByAsset
 * @param addFee if true, estimate fee and add feeOutput to transaction (default = false)
 * @param satsPerByte used for fee estimation (default = 0.1)
 * @param network used for fee output (default = regtest)
 */
export function buildTx(
  psetBase64: string,
  unspents: UtxoInterface[],
  recipients: RecipientInterface[],
  changeAddressByAsset: ChangeAddressFromAssetGetter,
  addFee: boolean = false,
  satsPerByte: number = 0.1,
  network: networks.Network = networks.regtest
): string {
  if (satsPerByte < 0.1) {
    throw new Error('satsPerByte minimum value is 0.1');
  }

  if (recipients.length === 0) {
    throw new Error(
      'need a least one recipient output to build the transaction'
    );
  }

  if (unspents.length === 0) {
    throw new Error('need at least one unspent to fund the transaction');
  }

  const { selectedUtxos, changeOutputs } = greedyCoinSelection(
    unspents,
    recipients,
    changeAddressByAsset
  );

  const inputs = selectedUtxos;

  // if not fee, just add selected unspents as inputs and specified outputs + change outputs to pset
  if (!addFee) {
    const outs = recipients.concat(changeOutputs);
    return addToTx(psetBase64, inputs, outs, network);
  }

  // otherwise, handle the fee output
  const fee = createFeeOutput(
    inputs.length,
    recipients.length,
    satsPerByte,
    network
  );

  const changeIndexLBTC: number = changeOutputs.findIndex(
    out => out.asset === network.assetHash
  );

  const diff = changeOutputs[changeIndexLBTC].value - fee.value;

  if (diff > 0) {
    changeOutputs[changeIndexLBTC].value = diff;
    const outs = recipients.concat(changeOutputs).concat(fee);
    return addToTx(psetBase64, inputs, outs, network);
  }
  // remove the change outputs
  changeOutputs.splice(changeIndexLBTC, 1);

  if (diff === 0) {
    const outs = recipients.concat(changeOutputs).concat(fee);
    return addToTx(psetBase64, inputs, outs, network);
  }

  const availableUnspents: UtxoInterface[] = [];
  for (const utxo of unspents) {
    if (!selectedUtxos.includes(utxo)) availableUnspents.push(utxo);
  }

  const coinSelectionResult = greedyCoinSelection(
    availableUnspents,
    // a little trick to only select the difference not covered by the change output
    [{ ...fee, value: diff }],
    changeAddressByAsset
  );

  const ins = inputs.concat(coinSelectionResult.selectedUtxos);
  const outs = recipients
    .concat(changeOutputs)
    .concat(fee)
    .concat(coinSelectionResult.changeOutputs);

  return addToTx(psetBase64, ins, outs, network);
}

/**
 * select utxo for outputs among unspents.
 * @param unspents a set of unspents.
 * @param outputs the outputs targetted by the coin selection
 */
export function greedyCoinSelection(
  unspents: UtxoInterface[],
  outputs: RecipientInterface[],
  changeAddressGetter: ChangeAddressFromAssetGetter
): CoinSelectionResult {
  const result: CoinSelectionResult = {
    selectedUtxos: [],
    changeOutputs: [],
  };

  const utxosGroupedByAsset = groupBy(unspents, 'asset') as Record<
    string,
    UtxoInterface[]
  >;
  const outputsGroupedByAsset = groupBy(outputs, 'asset') as Record<
    string,
    RecipientInterface[]
  >;

  for (const [asset, outputs] of Object.entries(outputsGroupedByAsset)) {
    const unspents = utxosGroupedByAsset[asset];
    if (!unspents) {
      throw new Error('need unspents for the asset: ' + asset);
    }

    const targetAmount: number = outputs.reduce(
      (acc: number, output: RecipientInterface) => acc + output.value,
      0
    );

    const { selected, changeAmount } = selectUtxos(unspents, targetAmount);

    result.selectedUtxos.push(...selected);

    if (changeAmount > 0) {
      const changeAddr = changeAddressGetter(asset);
      if (!changeAddr) {
        throw new Error('need change address for asset: ' + asset);
      }

      result.changeOutputs.push({
        asset: asset,
        value: changeAmount,
        address: changeAddr,
      });
    }
  }

  return result;
}

function selectUtxos(
  utxos: UtxoInterface[],
  targetAmount: number
): {
  selected: UtxoInterface[];
  changeAmount: number;
} {
  const selected: UtxoInterface[] = [];
  let total = 0;
  for (const utxo of utxos) {
    selected.push(utxo);
    total += utxo.value;

    if (total >= targetAmount) {
      return {
        selected,
        changeAmount: total - targetAmount,
      };
    }
  }

  throw new Error('not enough utxos in wallet to found: ' + targetAmount);
}

export function createFeeOutput(
  numInputs: number,
  numOutputs: number,
  satsPerByte: number,
  network: networks.Network
): RecipientInterface {
  const sizeEstimation = estimateTxSize(numInputs, numOutputs);
  const feeEstimation = Math.ceil(sizeEstimation * satsPerByte);

  return {
    asset: network.assetHash,
    value: feeEstimation,
    address: '',
  };
}

export function addToTx(
  psetBase64: string,
  unspents: UtxoInterface[],
  outputs: RecipientInterface[],
  network: networks.Network
): string {
  const pset = decodePset(psetBase64);
  const nonce = Buffer.from('00', 'hex');

  for (const { asset, value, address } of outputs) {
    const script =
      address === '' ? '' : laddress.toOutputScript(address, network);
    pset.addOutput({ asset, value, script, nonce });
  }

  for (const unspent of unspents) {
    pset.addInput({
      hash: unspent.txid,
      index: unspent.vout,
      witnessUtxo: unspent.prevout,
    });
  }

  return pset.toBase64();
}

export function decodePset(psetBase64: string): Psbt {
  let pset: Psbt;
  try {
    pset = Psbt.fromBase64(psetBase64);
  } catch (ignore) {
    throw new Error('Invalid pset');
  }
  return pset;
}

function groupBy(xs: Array<any>, key: string) {
  return xs.reduce(function(rv, x) {
    (rv[x[key]] = rv[x[key]] || []).push(x);
    return rv;
  }, {});
}
