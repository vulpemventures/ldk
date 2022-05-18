import {
  CoinSelectionResult,
  CoinSelector,
} from './coinselection/coinSelector';
import {
  ChangeAddressFromAssetGetter,
  RecipientInterface,
  UnblindedOutput,
  Output,
  CoinSelectorErrorFn,
} from './types';
import {
  Psbt,
  address as laddress,
  AssetHash,
  confidential,
} from 'liquidjs-lib';
import { checkCoinSelect, throwErrorHandler } from './coinselection/utils';
import { decodePset } from './utils';

export function craftSingleRecipientPset(
  unspents: UnblindedOutput[],
  recipient: RecipientInterface,
  coinSelector: CoinSelector,
  changeAddressByAsset: ChangeAddressFromAssetGetter,
  substractFeeFromRecipient = false,
  satsPerByte = DEFAULT_SATS_PER_BYTE
) {
  const network = laddress.getNetwork(recipient.address);
  const substractScenario =
    substractFeeFromRecipient && recipient.asset === network.assetHash;

  const firstSelection = coinSelector(throwErrorHandler)(
    unspents,
    [recipient],
    changeAddressByAsset
  );

  const fee = createFeeOutput(
    firstSelection.selectedUtxos.length,
    // Change outputs + 1 recipient + 1 fee
    firstSelection.changeOutputs.length + 2,
    satsPerByte,
    network.assetHash
  );

  let errorHandler: CoinSelectorErrorFn = throwErrorHandler;
  if (substractScenario) {
    errorHandler = (asset: string, need: number, has: number) => {
      if (asset === recipient.asset) {
        recipient.value = has - fee.value;
        return;
      } // do not throw error if not enougt fund with recipient's asset.
      throwErrorHandler(asset, need, has);
    };
  }

  const { selectedUtxos, changeOutputs } = coinSelector(errorHandler)(
    unspents,
    [recipient, fee],
    changeAddressByAsset
  );

  const outs = [recipient, ...changeOutputs, fee];
  checkCoinSelect(outs)(selectedUtxos);

  return addToTx(new Psbt({ network }).toBase64(), selectedUtxos, outs);
}

export interface BuildTxArgs {
  psetBase64: string;
  unspents: UnblindedOutput[];
  recipients: RecipientInterface[];
  coinSelector: CoinSelector;
  changeAddressByAsset: ChangeAddressFromAssetGetter;
  addFee?: boolean;
  satsPerByte?: number;
  errorHandler?: CoinSelectorErrorFn;
}

export const DEFAULT_SATS_PER_BYTE = 0.1;

function validateAndProcess(args: BuildTxArgs): BuildTxArgs {
  if (!args.satsPerByte) {
    args.satsPerByte = DEFAULT_SATS_PER_BYTE;
  }

  if (!args.errorHandler) {
    args.errorHandler = throwErrorHandler;
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
export function craftMultipleRecipientsPset(args: BuildTxArgs): string {
  // validate and deconstruct args object
  const {
    changeAddressByAsset,
    coinSelector,
    psetBase64,
    recipients,
    unspents,
    addFee,
    satsPerByte,
    errorHandler,
  } = validateAndProcess(args);

  const firstSelection = coinSelector(errorHandler!)(
    unspents,
    recipients,
    changeAddressByAsset
  );

  // if not fee, just add selected unspents as inputs and specified outputs + change outputs to pset
  if (!addFee) {
    const outs = recipients.concat(firstSelection.changeOutputs);
    checkCoinSelect(outs)(firstSelection.selectedUtxos);
    return addToTx(psetBase64, firstSelection.selectedUtxos, outs);
  }

  // otherwise, handle the fee output
  const fee = createFeeOutputFromPset(
    psetBase64,
    firstSelection,
    recipients,
    satsPerByte
  );
  const { changeOutputs, selectedUtxos } = coinSelector(errorHandler!)(
    unspents,
    [...recipients, fee],
    changeAddressByAsset
  );

  const outs = [...recipients, ...changeOutputs, fee];

  // check that input amount = output amount and input assets = output assets
  checkCoinSelect(outs)(selectedUtxos);

  return addToTx(psetBase64, selectedUtxos, outs);
}

function createFeeOutputFromPset(
  psetBase64: string,
  firstSelection: CoinSelectionResult,
  recipients: RecipientInterface[],
  satsPerByte: number | undefined
) {
  const pset = decodePset(psetBase64);
  const nbInputs =
    pset.data.inputs.length + firstSelection.selectedUtxos.length + 1;
  let nbOutputs =
    pset.data.outputs.length +
    recipients.length +
    firstSelection.changeOutputs.length +
    1;

  const feeAssetHash = laddress.getNetwork(recipients[0].address).assetHash;
  const fee = createFeeOutput(nbInputs, nbOutputs, satsPerByte!, feeAssetHash);
  return fee;
}

// this function create a recipient interface for Fee output using tx size estimation
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
  unspents: Output[],
  recipients: RecipientInterface[]
): string {
  const pset = decodePset(psetBase64);
  const nonce = Buffer.alloc(1);

  for (const { asset, value, address } of recipients) {
    const script =
      address === '' ? Buffer.alloc(0) : laddress.toOutputScript(address);
    pset.addOutput({
      asset: AssetHash.fromHex(asset, false).bytes,
      value: confidential.satoshiToConfidentialValue(value),
      script,
      nonce,
    });
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
