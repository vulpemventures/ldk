import { address as laddress } from 'liquidjs-lib';

import { CoinSelector } from './coinselection/coinSelector';
import {
  UtxoInterface,
  ChangeAddressFromAssetGetter,
  RecipientInterface,
} from './types';
import { decodePset } from './utils';

export interface BuildTxArgs {
  psetBase64: string;
  unspents: UtxoInterface[];
  recipients: RecipientInterface[];
  coinSelector: CoinSelector;
  changeAddressByAsset: ChangeAddressFromAssetGetter;
  addFee?: boolean;
  satsPerByte?: number;
}

function validateAndProcess(args: BuildTxArgs): BuildTxArgs {
  if (!args.satsPerByte) {
    args.satsPerByte = 0.1;
  }

  if (!args.addFee) {
    args.addFee = false;
  }

  if (args.addFee && args.satsPerByte < 0.1) {
    throw new Error('satsPerByte minimum value is 0.1');
  }

  if (args.recipients.length === 0) {
    throw new Error(
      'need a least one recipient output to build the transaction'
    );
  }

  if (args.unspents.length === 0) {
    throw new Error('need at least one unspent to fund the transaction');
  }

  return args;
}

/**
 * buildTx selects utxos among unspents to fill outputs' requirements,
 * then it adds the associated inputs and outputs to the tx.
 * finally it returns the new pset base64 encoded.
 * @param args buildTxArgs wraps arguments
 */
export function buildTx(args: BuildTxArgs): string {
  // validate and deconstruct args object
  const {
    changeAddressByAsset,
    coinSelector,
    psetBase64,
    recipients,
    unspents,
    addFee,
    satsPerByte,
  } = validateAndProcess(args);

  const { selectedUtxos, changeOutputs } = coinSelector(
    unspents,
    recipients,
    changeAddressByAsset
  );

  const inputs = selectedUtxos;

  // if not fee, just add selected unspents as inputs and specified outputs + change outputs to pset
  if (!addFee) {
    const outs = recipients.concat(changeOutputs);
    return addToTx(psetBase64, inputs, outs);
  }

  const pset = decodePset(psetBase64);
  const nbInputs = pset.data.inputs.length + inputs.length;
  const nbOutputs =
    pset.data.outputs.length + recipients.length + changeOutputs.length;

  const feeAssetHash = laddress.getNetwork(recipients[0].address).assetHash;
  // otherwise, handle the fee output
  const fee = createFeeOutput(nbInputs, nbOutputs, satsPerByte!, feeAssetHash);

  const changeIndexLBTC: number = changeOutputs.findIndex(
    out => out.asset === feeAssetHash
  );

  const diff =
    changeIndexLBTC === -1
      ? 0 - fee.value
      : changeOutputs[changeIndexLBTC].value - fee.value;

  if (diff > 0) {
    // changeAmount becomes the difference between fees and change base amount
    changeOutputs[changeIndexLBTC].value = diff;
    const outs = recipients.concat(changeOutputs).concat(fee);
    return addToTx(psetBase64, inputs, outs);
  }

  if (diff === 0) {
    const outs = recipients.concat(fee);
    return addToTx(psetBase64, inputs, outs);
  }

  const availableUnspents: UtxoInterface[] = [];
  for (const utxo of unspents) {
    if (!selectedUtxos.includes(utxo)) availableUnspents.push(utxo);
  }

  // re-estimate the fees with one additional input and change output
  const feeBis = createFeeOutput(
    nbInputs + 1,
    nbOutputs + 1,
    satsPerByte!,
    feeAssetHash
  );

  const coinSelectionResult = coinSelector(
    availableUnspents,
    [feeBis],
    changeAddressByAsset
  );

  const ins = inputs.concat(coinSelectionResult.selectedUtxos);
  const outs = recipients
    .concat(changeOutputs)
    .concat(coinSelectionResult.changeOutputs)
    .concat(feeBis);

  return addToTx(psetBase64, ins, outs);
}

export function createFeeOutput(
  numInputs: number,
  numOutputs: number,
  satsPerByte: number,
  assetHash: string
): RecipientInterface {
  const sizeEstimation = estimateTxSize(numInputs, numOutputs);
  const feeEstimation = Math.ceil(sizeEstimation * satsPerByte);

  return {
    asset: assetHash,
    value: feeEstimation,
    address: '',
  };
}

export function addToTx(
  psetBase64: string,
  unspents: UtxoInterface[],
  outputs: RecipientInterface[]
): string {
  const pset = decodePset(psetBase64);
  const nonce = Buffer.from('00', 'hex');

  for (const { asset, value, address } of outputs) {
    const script = address === '' ? '' : laddress.toOutputScript(address);
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

// estimate segwit transaction size in bytes depending on number of inputs and outputs
export function estimateTxSize(numInputs: number, numOutputs: number): number {
  const base = calcTxSize(false, numInputs, numOutputs, false);
  const total = calcTxSize(true, numInputs, numOutputs, true);
  const weight = base * 3 + total;
  const vsize = (weight + 3) / 4;

  return vsize;
}

function calcTxSize(
  withWitness: boolean,
  numInputs: number,
  numOutputs: number,
  isConfidential: boolean
) {
  const inputsSize = calcInputsSize(withWitness, numInputs);
  const outputsSize = calcOutputsSize(isConfidential, numOutputs);

  return (
    9 +
    varIntSerializeSize(numOutputs) +
    varIntSerializeSize(numInputs) +
    inputsSize +
    outputsSize
  );
}

function calcInputsSize(withWitness: boolean, numInputs: number): number {
  // prevout hash + prevout index
  let size = (32 + 8) * numInputs;
  if (withWitness) {
    // scriptsig + pubkey
    size += numInputs * (72 + 33);
  }

  return size;
}

function calcOutputsSize(isConfidential: boolean, numOutputs: number): number {
  // asset + value + empty nonce
  const baseOutputSize = 33 + 33 + 1;
  let size = baseOutputSize * numOutputs;

  if (isConfidential) {
    // rangeproof + surjectionproof + 32 bytes for nonce
    size += (4174 + 67 + 32) * numOutputs;
  }

  // fee asset + fee empty nonce + fee value
  size += 33 + 1 + 9;

  return size;
}

function varIntSerializeSize(val: number): number {
  const maxUINT16 = 65535;
  const maxUINT32 = 4294967295;

  if (val < 0xfd) {
    return 1;
  }

  if (val <= maxUINT16) {
    return 3;
  }

  if (val <= maxUINT32) {
    return 5;
  }

  return 9;
}
