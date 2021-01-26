import { CoinSelector } from './coinselection/coinSelector';
import {
  UtxoInterface,
  ChangeAddressFromAssetGetter,
  RecipientInterface,
} from './types';
import { Psbt, networks, address as laddress } from 'liquidjs-lib';
import { estimateTxSize } from './wallet';

export interface BuildTxArgs {
  psetBase64: string;
  unspents: UtxoInterface[];
  recipients: RecipientInterface[];
  coinSelector: CoinSelector;
  changeAddressByAsset: ChangeAddressFromAssetGetter;
  addFee?: boolean;
  satsPerByte?: number;
  network?: networks.Network;
}

function validateAndProcess(args: BuildTxArgs): BuildTxArgs {
  if (!args.network) {
    args.network = networks.regtest;
  }

  if (!args.satsPerByte) {
    args.satsPerByte = 0.1;
  }

  if (!args.addFee) {
    args.addFee = false;
  }

  if (args.satsPerByte < 0.1 && args.addFee) {
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
 * @param psetBase64
 * @param unspents
 * @param outputs
 * @param changeScriptByAsset
 * @param addFee if true, estimate fee and add feeOutput to transaction (default = false)
 * @param satsPerByte used for fee estimation (default = 0.1)
 * @param network used for fee output (default = regtest)
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
    network,
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
    return addToTx(psetBase64, inputs, outs, network!);
  }

  const pset = decodePset(psetBase64);
  const nbInputs = pset.data.inputs.length + inputs.length;
  let nbOutputs =
    pset.data.outputs.length + recipients.length + changeOutputs.length + 1;

  // otherwise, handle the fee output
  const fee = createFeeOutput(nbInputs, nbOutputs, satsPerByte!, network!);

  const changeIndexLBTC: number = changeOutputs.findIndex(
    out => out.asset === network!.assetHash
  );

  let diff =
    changeIndexLBTC === -1
      ? 0
      : changeOutputs[changeIndexLBTC].value - fee.value;

  if (diff > 0) {
    changeOutputs[changeIndexLBTC].value = diff;
    const outs = recipients.concat(changeOutputs).concat(fee);
    return addToTx(psetBase64, inputs, outs, network!);
  }
  // remove the change outputs (if it exists)
  if (changeIndexLBTC > 0) {
    changeOutputs.splice(changeIndexLBTC, 1);
    nbOutputs -= 1;
  }

  if (diff === 0) {
    const outs = recipients.concat(changeOutputs).concat(fee);
    return addToTx(psetBase64, inputs, outs, network!);
  }

  const availableUnspents: UtxoInterface[] = [];
  for (const utxo of unspents) {
    if (!selectedUtxos.includes(utxo)) availableUnspents.push(utxo);
  }

  // re-estimate the fees with one additional output
  const feeBis = createFeeOutput(
    nbInputs + 1,
    nbOutputs + changeOutputs.length,
    satsPerByte!,
    network!
  );

  // reassign diff to new value
  diff = fee.value - feeBis.value + diff;

  const coinSelectionResult = coinSelector(
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

  return addToTx(psetBase64, ins, outs, network!);
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
