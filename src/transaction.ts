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
  ElementsValue,
} from 'liquidjs-lib';
import { checkCoinSelect, throwErrorHandler } from './coinselection/utils';
import { decodePset, isConfidentialOutput } from './utils';
import { varSliceSize, varuint } from 'liquidjs-lib/src/bufferutils';

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

  let nbConfOutputs = 0;
  let nbUnconfOutputs = 0;
  const outScriptSizes = [
    varSliceSize(laddress.toOutputScript(recipient.address)),
  ];

  if (laddress.isConfidential(recipient.address)) nbConfOutputs++;
  else nbUnconfOutputs++;

  for (const change of firstSelection.changeOutputs) {
    outScriptSizes.push(varSliceSize(laddress.toOutputScript(change.address)));
    if (laddress.isConfidential(change.address)) nbConfOutputs++;
    else nbUnconfOutputs++;
  }

  const fee = createFeeOutput(
    firstSelection.selectedUtxos.length,
    nbConfOutputs,
    nbUnconfOutputs,
    outScriptSizes,
    satsPerByte,
    network.assetHash
  );

  let errorHandler: CoinSelectorErrorFn = throwErrorHandler;
  if (substractScenario) {
    errorHandler = (asset: string, need: number, has: number) => {
      if (asset === recipient.asset) {
        recipient.value = has - fee.value;
        return;
      } // do not throw error if not enough fund with recipient's asset.
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
    pset.data.inputs.length + firstSelection.selectedUtxos.length;

  let nbConfOutputs = 0;
  let nbUnconfOutputs = 0;
  const outScriptSizes: number[] = [];
  for (const output of pset.TX.outs) {
    outScriptSizes.push(varSliceSize(output.script));
    if (isConfidentialOutput(output)) nbConfOutputs++;
    else nbUnconfOutputs++;
  }

  for (const recipient of recipients) {
    outScriptSizes.push(
      varSliceSize(laddress.toOutputScript(recipient.address))
    );
    if (laddress.isConfidential(recipient.address)) nbConfOutputs++;
    else nbUnconfOutputs++;
  }

  const feeAssetHash = laddress.getNetwork(recipients[0].address).assetHash;
  const fee = createFeeOutput(
    nbInputs,
    nbConfOutputs,
    nbUnconfOutputs,
    outScriptSizes,
    satsPerByte!,
    feeAssetHash
  );
  return fee;
}

// this function create a recipient interface for Fee output using tx size estimation
export function createFeeOutput(
  numInputs: number,
  numConfidentialOutputs: number,
  numUnconfidentialOutputs: number,
  outScriptSizes: number[],
  satsPerByte: number,
  assetHash: string
): RecipientInterface {
  const sizeEstimation = estimateTxSize(
    numInputs,
    numConfidentialOutputs,
    numUnconfidentialOutputs,
    outScriptSizes
  );
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
      asset: AssetHash.fromHex(asset).bytes,
      value: ElementsValue.fromNumber(value).bytes,
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
export function estimateTxSize(
  numInputs: number,
  numConfidentialOutputs: number,
  numUnconfidentialOutputs: number,
  outScriptSizes: number[]
): number {
  // we do not include confidential proofs in the base size estimation
  const base = calcTxSize(
    false,
    numInputs,
    numUnconfidentialOutputs,
    numConfidentialOutputs,
    outScriptSizes
  );
  const total = calcTxSize(
    true,
    numInputs,
    numUnconfidentialOutputs,
    numConfidentialOutputs,
    outScriptSizes
  );
  const weight = base * 3 + total;
  const vsize = (weight + 3) / 4;

  return vsize;
}

function calcTxSize(
  withWitness: boolean,
  numInputs: number,
  numUnconfidentialOutputs: number,
  numConfidentialOutputs: number,
  outScriptSizes: number[]
): number {
  let txSize = calcTxBaseSize(
    numInputs,
    numUnconfidentialOutputs,
    numConfidentialOutputs,
    outScriptSizes
  );
  if (withWitness) {
    txSize += calcTxWitnessSize(
      numInputs,
      numUnconfidentialOutputs,
      numConfidentialOutputs
    );
  }
  return txSize;
}

// TODO: at the moment calcTxBaseSize and calcTxWitnessSize assume ALL inputs
// are of type p2wpkh. These function should be made more generic by expecting
// a list of input script types and an optional list of auxiliary redeem script
// sizes and witness sizes respectively.
function calcTxBaseSize(
  numInputs: number,
  numUnconfidentialOutputs: number,
  numConfidentialOutputs: number,
  outScriptSizes: number[]
): number {
  // hash + index + sequence
  const inBaseSize = (40 + 1) * numInputs;
  // asset + value + nonce commitments
  let outBaseSize = (33 + 33 + 33) * numConfidentialOutputs;
  // asset + value + empty nonce
  outBaseSize += (33 + 9 + 1) * numUnconfidentialOutputs;
  // add output script sizes
  outBaseSize = outScriptSizes.reduce((a, b) => a + b, outBaseSize);
  // add size of unconf fee out
  // asset + value + empty script + empty nonce
  outBaseSize += 33 + 9 + 1 + 1;

  return (
    9 +
    varuint.encodingLength(numInputs) +
    varuint.encodingLength(outScriptSizes.length + 1) +
    inBaseSize +
    outBaseSize
  );
}

function calcTxWitnessSize(
  numInputs: number,
  numUnconfidentialOutputs: number,
  numConfidentialOutputs: number
): number {
  // len(witness) + witness[sig, pubkey] + empty issuance proof + empty token proof + empty pegin witness
  const insSize = (1 + 107 + 1 + 1 + 1) * numInputs;
  // size(range proof) + proof + size(surjection proof) + proof
  let outsSize = (3 + 4174 + 1 + 67) * numConfidentialOutputs;
  // empty range proof + empty surjection proof for unconf outs + fee out
  outsSize += (1 + 1) * numUnconfidentialOutputs + 1;
  return insSize + outsSize;
}
