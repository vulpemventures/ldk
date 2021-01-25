import axios from 'axios';
import {
  Network,
  networks,
  address,
  Psbt,
  confidential,
  Transaction,
  TxOutput,
} from 'liquidjs-lib';
import { AddressInterface } from './types';
import {
  isConfidentialOutput,
  toAssetHash,
  toNumber,
  unblindOutput,
} from './utils';

/**
 * Wallet abstraction.
 */
export interface WalletInterface {
  network: Network;
  addresses: AddressInterface[];
  blindingPrivateKeyByScript: Record<string, Buffer>;
  createTx(): string;
  updateTx(
    psetBase64: string,
    unspents: Array<UtxoInterface>,
    inputAmount: number,
    outputAmount: number,
    inputAsset: string,
    outputAsset: string,
    outputAddress: AddressInterface,
    changeAddress: AddressInterface
  ): any;
}

export interface AddressWithBlindingKey {
  address: string;
  blindingKey: string;
}

/**
 * Implementation of Wallet Interface.
 * @member network type of network (regtest...)
 * @member addresses list of AddressInterface.
 * @member blindingPrivateKeyByScript a map scriptPubKey --> blindingPrivateKey.
 * @method createTx init empty PSET.
 * @method updateTx update a PSET with outputs and inputs (for Swap tx).
 */
export class Wallet implements WalletInterface {
  network: Network;
  addresses: AddressInterface[] = [];
  blindingPrivateKeyByScript: Record<string, Buffer> = {};

  constructor({
    addresses,
    network,
  }: {
    addresses: AddressInterface[];
    network: Network;
  }) {
    this.network = network;
    this.addresses = addresses;
    addresses.forEach((a: AddressInterface) => {
      const scriptHex = address
        .toOutputScript(a.confidentialAddress, network)
        .toString('hex');
      this.blindingPrivateKeyByScript[scriptHex] = Buffer.from(
        a.blindingPrivateKey,
        'hex'
      );
    });
  }

  /**
   * Returns an empty liquidjs lib Psbt instance.
   */
  createTx(): string {
    const pset = new Psbt({ network: this.network });
    return pset.toBase64();
  }

  /**
   * @param psetBase64 the Pset to update, base64 encoded.
   * @param unspents unspent that will be used to found the transaction.
   * @param inputAmount the amount to found with unspents.
   * @param outputAmount the amount to send via output.
   * @param inputAsset the assetHash of inputs.
   * @param outputAsset the asset hash of output.
   * @param outputAddress the address that will receive the `outputAmount` of `outputAsset`.
   * @param changeAddress the change address.
   */
  updateTx(
    psetBase64: string,
    unspents: Array<UtxoInterface>,
    inputAmount: number,
    outputAmount: number,
    inputAsset: string,
    outputAsset: string,
    outputAddress: AddressInterface,
    changeAddress: AddressInterface
  ): any {
    const pset = decodePset(psetBase64);

    const { selectedUnspents, change } = coinselect(
      unspents,
      inputAmount,
      inputAsset,
      this.blindingPrivateKeyByScript
    );

    let inputBlindingKeys: Record<string, Buffer> = {};
    let outputBlindingKeys: Record<string, Buffer> = {};

    selectedUnspents.forEach((i: UtxoInterface) => {
      pset.addInput({
        // if hash is string, txid, if hash is Buffer, is reversed compared to txid
        hash: i.txid,
        index: i.vout,
        //We put here the blinded prevout
        witnessUtxo: i.prevout,
      });

      // we update the inputBlindingKeys map after we add an input to the transaction
      const scriptHex = i.prevout.script.toString('hex');
      inputBlindingKeys[scriptHex] = this.blindingPrivateKeyByScript[scriptHex];
    });

    const receivingScript = address
      .toOutputScript(outputAddress.confidentialAddress, this.network)
      .toString('hex');

    // The receiving output
    pset.addOutput({
      script: receivingScript,
      value: confidential.satoshiToConfidentialValue(outputAmount),
      asset: outputAsset,
      nonce: Buffer.from('00', 'hex'),
    });

    // we update the outputBlindingKeys map after we add the receiving output to the transaction
    outputBlindingKeys[receivingScript] = Buffer.from(
      outputAddress.blindingPrivateKey,
      'hex'
    );

    if (change > 0) {
      const changeScript = address
        .toOutputScript(changeAddress.confidentialAddress, this.network)
        .toString('hex');

      // Change
      pset.addOutput({
        script: changeScript,
        value: confidential.satoshiToConfidentialValue(change),
        asset: inputAsset,
        nonce: Buffer.from('00', 'hex'),
      });

      // we update the outputBlindingKeys map after we add the change output to the transaction
      outputBlindingKeys[changeScript] = Buffer.from(
        changeAddress.blindingPrivateKey,
        'hex'
      );
    }

    return {
      psetBase64: pset.toBase64(),
      inputBlindingKeys,
      outputBlindingKeys,
    };
  }

  static toHex(psetBase64: string): string {
    let pset: Psbt;
    try {
      pset = Psbt.fromBase64(psetBase64);
    } catch (ignore) {
      throw new Error('Invalid pset');
    }

    pset.validateSignaturesOfAllInputs();
    pset.finalizeAllInputs();

    return pset.extractTransaction().toHex();
  }
}

/**
 * Factory: list of addresses --to--> Wallet
 * @param addresses a list of addressInterface.
 * @param network network type
 */
export function walletFromAddresses(
  addresses: AddressInterface[],
  network?: string
): WalletInterface {
  const _network = network
    ? (networks as Record<string, Network>)[network]
    : networks.liquid;

  try {
    return new Wallet({
      addresses,
      network: _network,
    });
  } catch (ignore) {
    throw new Error('fromAddress: Invalid addresses list or network');
  }
}

function decodePset(psetBase64: string) {
  let pset: Psbt;
  try {
    pset = Psbt.fromBase64(psetBase64);
  } catch (ignore) {
    throw new Error('Invalid pset');
  }
  return pset;
}

export interface UtxoInterface {
  txid: string;
  vout: number;
  asset: string;
  value: number;
  prevout: TxOutput;
}

export async function fetchTxHex(txId: string, url: string): Promise<string> {
  return (await axios.get(`${url}/tx/${txId}/hex`)).data;
}

export async function fetchUtxos(
  address: string,
  url: string
): Promise<Array<UtxoInterface>> {
  return (await axios.get(`${url}/address/${address}/utxo`)).data;
}

export async function* fetchAndUnblindUtxosGenerator(
  addressesAndBlindingKeys: Array<AddressWithBlindingKey>,
  url: string
): AsyncGenerator<UtxoInterface, number, undefined> {
  let numberOfUtxos = 0;

  // the generator repeats the process for each addresses
  for (const { address, blindingKey } of addressesAndBlindingKeys) {
    const blindedUtxos = await fetchUtxos(address, url);
    const unblindedUtxosPromises = blindedUtxos.map((utxo: UtxoInterface) =>
      // this is a non blocking function, returning the base utxo if the unblind failed
      tryToUnblindUtxo(utxo, blindingKey, url)
    );

    // increase the number of utxos
    numberOfUtxos += unblindedUtxosPromises.length;

    // at each 'next' call, the generator will return the result of the next promise
    for (const promise of unblindedUtxosPromises) {
      yield await promise;
    }
  }

  return numberOfUtxos;
}

export async function fetchAndUnblindUtxos(
  addressesAndBlindingKeys: Array<AddressWithBlindingKey>,
  url: string
): Promise<UtxoInterface[]> {
  const utxosGenerator = fetchAndUnblindUtxosGenerator(
    addressesAndBlindingKeys,
    url
  );
  const utxos: UtxoInterface[] = [];

  let iterator = await utxosGenerator.next();
  while (!iterator.done) {
    utxos.push(iterator.value);
    iterator = await utxosGenerator.next();
  }

  return utxos;
}

async function tryToUnblindUtxo(
  utxo: UtxoInterface,
  blindPrivKey: string,
  url: string
): Promise<UtxoInterface> {
  try {
    const unblinded = await unblindUtxo(utxo, blindPrivKey, url);
    return unblinded;
  } catch (_) {
    return utxo;
  }
}

async function unblindUtxo(
  utxo: UtxoInterface,
  blindPrivKey: string,
  url: string
): Promise<UtxoInterface> {
  const prevoutHex: string = await fetchTxHex(utxo.txid, url);
  const prevout = Transaction.fromHex(prevoutHex).outs[utxo.vout];

  const unblindedUtxo = confidential.unblindOutput(
    prevout.nonce,
    Buffer.from(blindPrivKey, 'hex'),
    prevout.rangeProof!,
    prevout.value,
    prevout.asset,
    prevout.script
  );

  return {
    txid: utxo.txid,
    vout: utxo.vout,
    asset: (unblindedUtxo.asset.reverse() as Buffer).toString('hex'),
    value: parseInt(unblindedUtxo.value, 10),
    prevout: prevout,
  };
}

export async function fetchBalances(
  address: string,
  blindPrivKey: string,
  url: string
) {
  const utxoInterfaces = await fetchAndUnblindUtxos(
    [{ address, blindingKey: blindPrivKey }],
    url
  );
  return (utxoInterfaces as any).reduce(
    (storage: { [x: string]: any }, item: { [x: string]: any; value: any }) => {
      // get the first instance of the key by which we're grouping
      var group = item['asset'];

      // set `storage` for this instance of group to the outer scope (if not empty) or initialize it
      storage[group] = storage[group] || 0;

      // add this item to its group within `storage`
      storage[group] += item.value;

      // return the updated storage to the reduce function, which will then loop through the next
      return storage;
    },
    {}
  ); // {} is the initial value of the storage
}

export interface BlindedOutputInterface {
  script: string;
  blindedValue: Buffer;
  blindedAsset: Buffer;
  nonce: Buffer;
  rangeProof: Buffer;
  surjectionProof: Buffer;
}

export interface UnblindedOutputInterface {
  script: string;
  value: number;
  asset: string;
}

export interface InputInterface {
  txid: string;
  vout: number;
  prevout: BlindedOutputInterface | UnblindedOutputInterface;
}

export interface TxInterface {
  txid: string;
  fee: number;
  status: {
    confirmed: boolean;
    blockHeight?: number;
    blockHash?: string;
    blockTime?: number;
  };
  vin: Array<InputInterface>;
  vout: Array<BlindedOutputInterface | UnblindedOutputInterface>;
}

export function isBlindedOutputInterface(
  object: any
): object is BlindedOutputInterface {
  return 'surjectionProof' in object && 'rangeProof' in object;
}

// Esplora tx format
interface EsploraTx {
  txid: string;
  version: number;
  locktime: number;
  size: number;
  weight: number;
  fee: number;
  status: {
    confirmed: boolean;
    block_height: number;
    block_hash: string;
    block_time: number;
  };
  vin: Array<{
    txid: string;
    vout: number;
    scriptsig: string;
    witness: string[];
    is_coinbase: boolean;
    sequence: number;
    is_pegin: boolean;
  }>;
  vout: Array<{
    scriptpubkey: string;
    scriptpubkey_type: string;
    valuecommitment: string;
    assetcommitment: string;
  }>;
}

// define function that takes a script as input and returns a blinding key (or undefined)
export type BlindingKeyGetter = (script: string) => string | undefined;

export async function fetchAndUnblindTxs(
  addresses: string[],
  blindingKeyGetter: BlindingKeyGetter,
  explorerUrl: string
): Promise<TxInterface[]> {
  const generator = fetchAndUnblindTxsGenerator(
    addresses,
    blindingKeyGetter,
    explorerUrl
  );
  const txs: Array<TxInterface> = [];

  let iterator = await generator.next();
  while (!iterator.done) {
    txs.push(iterator.value);
    iterator = await generator.next();
  }

  return txs;
}

/**
 * fetch all tx associated to an address and unblind the tx's outputs and prevouts.
 * @param explorerUrl the esplora endpoint
 */
export async function* fetchAndUnblindTxsGenerator(
  addresses: string[],
  blindingKeyGetter: BlindingKeyGetter,
  explorerUrl: string
): AsyncGenerator<TxInterface, void, undefined> {
  for (const address of addresses) {
    const txsGenerator = fetchTxsGenerator(address, explorerUrl);
    let txIterator = await txsGenerator.next();
    while (!txIterator.done) {
      const tx = txIterator.value;
      yield unblindTransactionPrevoutsAndOutputs(tx, blindingKeyGetter);

      txIterator = await txsGenerator.next();
    }
  }
}

/**
 * Fetch all the txs associated to a given address and unblind them using the blindingPrivateKey.
 * @param address the confidential address
 * @param explorerUrl the Esplora URL API using to fetch blockchain data.
 */
async function* fetchTxsGenerator(
  address: string,
  explorerUrl: string
): AsyncGenerator<TxInterface, number, undefined> {
  let lastSeenTxid = undefined;
  let newTxs: EsploraTx[] = [];
  let numberOfTxs: number = 0;

  do {
    // fetch up to 25 txs
    newTxs = await fetch25newestTxsForAddress(
      address,
      explorerUrl,
      lastSeenTxid
    );

    numberOfTxs += newTxs.length;

    // convert them into txInterface
    const txs: Promise<TxInterface>[] = newTxs.map(tx =>
      esploraTxToTxInterface(tx, explorerUrl)
    );

    for (const tx of txs) {
      yield await tx;
    }
  } while (newTxs.length < 25);

  return numberOfTxs;
}

async function esploraTxToTxInterface(
  esploraTx: EsploraTx,
  explorerUrl: string
): Promise<TxInterface> {
  const inputTxIds: string[] = [];
  const inputVouts: number[] = [];

  for (const input of esploraTx.vin) {
    inputTxIds.push(input.txid);
    inputVouts.push(input.vout);
  }

  const prevoutTxHexs = await Promise.all(
    inputTxIds.map(txid => fetchTxHex(txid, explorerUrl))
  );

  const prevoutAsOutput = prevoutTxHexs.map((hex: string, index: number) =>
    txOutputToOutputInterface(Transaction.fromHex(hex).outs[inputVouts[index]])
  );

  const txInputs: InputInterface[] = inputTxIds.map(
    (txid: string, index: number) => {
      return {
        prevout: prevoutAsOutput[index],
        txid: txid,
        vout: inputVouts[index],
      };
    }
  );

  const txHex = await fetchTxHex(esploraTx.txid, explorerUrl);
  const transaction = Transaction.fromHex(txHex);

  const txOutputs = transaction.outs.map(txOutputToOutputInterface);

  const tx: TxInterface = {
    txid: esploraTx.txid,
    vin: txInputs,
    vout: txOutputs,
    fee: esploraTx.fee,
    status: {
      confirmed: esploraTx.status.confirmed,
      blockHash: esploraTx.status.block_hash,
      blockHeight: esploraTx.status.block_height,
      blockTime: esploraTx.status.block_time,
    },
  };

  return tx;
}

function txOutputToOutputInterface(
  txOutput: TxOutput
): BlindedOutputInterface | UnblindedOutputInterface {
  if (isConfidentialOutput(txOutput)) {
    const blindedOutput: BlindedOutputInterface = {
      blindedAsset: txOutput.asset,
      blindedValue: txOutput.value,
      nonce: txOutput.nonce,
      rangeProof: txOutput.rangeProof!,
      surjectionProof: txOutput.surjectionProof!,
      script: txOutput.script.toString('hex'),
    };
    return blindedOutput;
  }

  const unblindedOutput: UnblindedOutputInterface = {
    asset: toAssetHash(txOutput.asset),
    value: toNumber(txOutput.value),
    script: txOutput.script.toString('hex'),
  };

  return unblindedOutput;
}

/**
 * takes the a TxInterface and try to transform BlindedOutputInterface to UnblindedOutputInterface (prevouts & outputs)
 * @param tx transaction to unblind
 * @param blindingPrivateKeys the privateKeys using to unblind the outputs.
 */
async function unblindTransactionPrevoutsAndOutputs(
  tx: TxInterface,
  blindingPrivateKeyGetter: BlindingKeyGetter
): Promise<TxInterface> {
  const promises: Promise<void>[] = [];

  // try to unblind prevouts, if success replace blinded prevout by unblinded prevout
  for (let inputIndex = 0; inputIndex < tx.vin.length; inputIndex++) {
    const prevout = tx.vin[inputIndex].prevout;
    if (isBlindedOutputInterface(prevout)) {
      const promise = async () => {
        const blindingKey = blindingPrivateKeyGetter(prevout.script);
        if (blindingKey) {
          const unblinded = tryToUnblindOutput(prevout, blindingKey);
          tx.vin[inputIndex].prevout = unblinded;
        }
      };

      promises.push(promise());
    }
  }

  // try to unblind outputs
  for (let outputIndex = 0; outputIndex < tx.vout.length; outputIndex++) {
    const output = tx.vout[outputIndex];
    if (isBlindedOutputInterface(output)) {
      const promise = async () => {
        const blindingKey = blindingPrivateKeyGetter(output.script);
        if (blindingKey) {
          const unblinded = tryToUnblindOutput(output, blindingKey);
          tx.vout[outputIndex] = unblinded;
        }
      };

      promises.push(promise());
    }
  }

  await Promise.all(promises);

  return tx;
}

function tryToUnblindOutput(
  output: BlindedOutputInterface,
  BlindingPrivateKey: string
): UnblindedOutputInterface {
  const blindPrivateKeyBuffer = Buffer.from(BlindingPrivateKey, 'hex');

  const unblindedResult = confidential.unblindOutput(
    output.nonce,
    blindPrivateKeyBuffer,
    output.rangeProof,
    output.blindedValue,
    output.blindedAsset,
    Buffer.from(output.script, 'hex')
  );

  const unblindedOutput: UnblindedOutputInterface = {
    asset: Buffer.from(unblindedResult.asset.reverse()).toString('hex'),
    value: parseInt(unblindedResult.value, 10),
    script: output.script,
  };

  return unblindedOutput;
}

async function fetch25newestTxsForAddress(
  address: string,
  explorerUrl: string,
  lastSeenTxid?: string
): Promise<EsploraTx[]> {
  let url = `${explorerUrl}/address/${address}/txs/chain`;
  if (lastSeenTxid) {
    url += `/${lastSeenTxid}`;
  }

  const response = await axios.get(url);
  return response.data;
}

/*
 * Select a set of unspent in `utxos` such as sum(utxo.value) >= `amount` && where utxo.asset = `asset`.
 * Returns change and selected unspent outputs.
 * @param utxos the unspents to search in.
 * @param amount the amount of coin to search.
 * @param asset the asset hash.
 * @param inputBlindingKeys map a hex encoded script to a blinding private key
 */
export function coinselect(
  utxos: Array<UtxoInterface>,
  amount: number,
  asset: string,
  inputBlindingKeys: Record<string, Buffer>
) {
  let unspents = [];
  let availableSat = 0;
  let change = 0;

  for (let i = 0; i < utxos.length; i++) {
    const utxo = utxos[i];

    // confidential
    if (isConfidentialOutput(utxo.prevout)) {
      const { asset: unblindAsset, value } = unblindOutput(
        utxo.prevout,
        inputBlindingKeys[utxo.prevout.script.toString('hex')]
      );

      if (toAssetHash(unblindAsset) !== asset) continue;
      unspents.push(utxo);
      availableSat += value;
      if (availableSat >= amount) break;
      continue;
    }

    // unconfidential
    if (toAssetHash(utxo.prevout.asset) !== asset) continue;
    unspents.push(utxo);
    availableSat += confidential.confidentialValueToSatoshi(utxo.prevout.value);
    if (availableSat >= amount) break;
  }

  if (availableSat < amount)
    throw new Error('You do not have enough in your wallet');

  change = availableSat - amount;

  return { selectedUnspents: unspents, change };
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
