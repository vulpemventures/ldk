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
  buildTx(
    psetBase64: string,
    unspents: Array<UtxoInterface>,
    recipient: string,
    amount: number,
    asset: string,
    changeAddress: string
  ): string;
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
   * Returns an unsigned pset base64 encoded with a valid transaction that spends the given asset versus a recipient.
   * @param psetBase64
   * @param unspents
   * @param recipient
   * @param amount
   * @param asset
   * @param changeAddress
   */
  buildTx(
    psetBase64: string,
    unspents: Array<UtxoInterface>,
    recipient: string,
    amount: number,
    asset: string,
    changeAddress: string
  ): string {
    const pset = decodePset(psetBase64);

    // at 0.1 sat per byte means pretty big transactions
    const FIXED_FEE = 2000;
    let inputBlindingKeys: Array<Buffer> = [];
    let outputBlindingKeys: Array<Buffer> = [];

    let lbtcAmountToLookup = FIXED_FEE;
    if (asset === this.network.assetHash) {
      lbtcAmountToLookup += amount;
      // The receiving output of LBTC
      const recipientScript = address
        .toOutputScript(recipient, this.network)
        .toString('hex');
      pset.addOutput({
        script: recipientScript,
        value: confidential.satoshiToConfidentialValue(amount),
        asset: this.network.assetHash,
        nonce: Buffer.from('00', 'hex'),
      });
      // Add the receiving blinding pub key
      outputBlindingKeys.push(address.fromConfidential(recipient).blindingKey);
    } else {
      // coin select the asset
      const { selectedUnspents, change } = coinselect(
        unspents,
        amount,
        asset,
        this.blindingPrivateKeyByScript
      );

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
        inputBlindingKeys.push(this.blindingPrivateKeyByScript[scriptHex]);
      });

      // The receiving output of the asset
      const recipientScript = address
        .toOutputScript(recipient, this.network)
        .toString('hex');
      pset.addOutput({
        script: recipientScript,
        value: confidential.satoshiToConfidentialValue(amount),
        asset: asset,
        nonce: Buffer.from('00', 'hex'),
      });

      // we update the outputBlindingKeys map after we add the change output to the transaction
      outputBlindingKeys.push(address.fromConfidential(recipient).blindingKey);

      if (change > 0) {
        // Get the script from address
        const changeScript = address
          .toOutputScript(changeAddress, this.network)
          .toString('hex');
        // Change of the asset
        pset.addOutput({
          script: changeScript,
          value: confidential.satoshiToConfidentialValue(change),
          asset: asset,
          nonce: Buffer.from('00', 'hex'),
        });

        // we update the outputBlindingKeys map after we add the change output to the transaction
        outputBlindingKeys.push(
          address.fromConfidential(changeAddress).blindingKey
        );
      }
    }

    const {
      selectedUnspents: lbtcSelectedUnspents,
      change: lbtcChange,
    } = coinselect(
      unspents,
      lbtcAmountToLookup,
      this.network.assetHash,
      this.blindingPrivateKeyByScript
    );

    lbtcSelectedUnspents.forEach((i: UtxoInterface) => {
      pset.addInput({
        // if hash is string, txid, if hash is Buffer, is reversed compared to txid
        hash: i.txid,
        index: i.vout,
        //We put here the blinded prevout
        witnessUtxo: i.prevout,
      });

      // we update the inputBlindingKeys map after we add an input to the transaction
      const scriptHex = i.prevout.script.toString('hex');
      inputBlindingKeys.push(this.blindingPrivateKeyByScript[scriptHex]);
    });

    if (lbtcChange > 0) {
      const lbtcChangeScript = address
        .toOutputScript(changeAddress, this.network)
        .toString('hex');
      // Change of LBTC
      pset.addOutput({
        script: lbtcChangeScript,
        value: confidential.satoshiToConfidentialValue(lbtcChange),
        asset: this.network.assetHash,
        nonce: Buffer.from('00', 'hex'),
      });

      // we update the outputBlindingKeys map after we add the change output to the transaction
      outputBlindingKeys.push(
        address.fromConfidential(changeAddress).blindingKey
      );
    }

    // fee output
    pset.addOutput({
      script: Buffer.alloc(0),
      value: confidential.satoshiToConfidentialValue(FIXED_FEE),
      asset: this.network.assetHash,
      nonce: Buffer.from('00', 'hex'),
    });

    // Let's blind all the outputs. The order is important (same of output and some blinding key)
    // The alice linding private key is an hex string, we need to pass to Buffer.
    pset.blindOutputs(inputBlindingKeys, outputBlindingKeys);

    return pset.toBase64();
  }

  /**
   *
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

export async function fetchAndUnblindUtxos(
  address: string,
  blindPrivKey: string,
  url: string
): Promise<Array<UtxoInterface>> {
  const blindedUtxos = await fetchUtxos(address, url);
  const prevoutHexes = await Promise.all(
    blindedUtxos.map((utxo: UtxoInterface) => fetchTxHex(utxo.txid, url))
  );

  const unblindedUtxos = blindedUtxos.map(
    (blindedUtxo: UtxoInterface, index: number) => {
      const prevout = Transaction.fromHex(String(prevoutHexes[index])).outs[
        blindedUtxo.vout
      ];

      const unblindedUtxo = confidential.unblindOutput(
        prevout.nonce,
        Buffer.from(blindPrivKey, 'hex'),
        prevout.rangeProof!,
        prevout.value,
        prevout.asset,
        prevout.script
      );

      return {
        txid: blindedUtxo.txid,
        vout: blindedUtxo.vout,
        asset: (unblindedUtxo.asset.reverse() as Buffer).toString('hex'),
        value: parseInt(unblindedUtxo.value, 10),
        prevout: prevout,
      };
    }
  );
  return unblindedUtxos;
}

export async function fetchBalances(
  address: string,
  blindPrivKey: string,
  url: string
) {
  const utxoInterfaces = await fetchAndUnblindUtxos(address, blindPrivKey, url);
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

/**
 * fetch all tx associated to an address and unblind the tx's outputs and prevouts.
 * @param address address to fetch
 * @param blindingPrivateKeys private blinding key used to unblind prevouts and outputs
 * @param explorerUrl the esplora endpoint
 */
export async function fetchAndUnblindTxs(
  address: string,
  blindingPrivateKeys: string[],
  explorerUrl: string
): Promise<TxInterface[]> {
  const txs = await fetchTxs(address, explorerUrl);
  const unblindedTxs = txs.map(tx =>
    unblindTransactionPrevoutsAndOutputs(tx, blindingPrivateKeys)
  );
  return unblindedTxs;
}

/**
 * Fetch all the txs associated to a given address and unblind them using the blindingPrivateKey.
 * @param address the confidential address
 * @param explorerUrl the Esplora URL API using to fetch blockchain data.
 */
async function fetchTxs(
  address: string,
  explorerUrl: string
): Promise<TxInterface[]> {
  const txs: EsploraTx[] = [];
  let lastSeenTxid = undefined;

  do {
    const newTxs: EsploraTx[] = await fetch25newestTxsForAddress(
      address,
      explorerUrl,
      lastSeenTxid
    );

    txs.push(...newTxs);
    if (newTxs.length === 25) lastSeenTxid = newTxs[24].txid;
  } while (lastSeenTxid != null);

  return Promise.all(txs.map(tx => esploraTxToTxInterface(tx, explorerUrl)));
}

async function esploraTxToTxInterface(
  esploraTx: EsploraTx,
  explorerUrl: string
): Promise<TxInterface> {
  const inputTxIds = esploraTx.vin.map(input => input.txid);
  const inputVouts = esploraTx.vin.map(input => input.vout);
  const prevoutTxHexs = await Promise.all(
    inputTxIds.map(txid => fetchTxHex(txid, explorerUrl))
  );

  const prevouts = prevoutTxHexs.map(
    (hex: string, index: number) =>
      Transaction.fromHex(hex).outs[inputVouts[index]]
  );
  const prevoutAsOutput = prevouts.map(txOutputToOutputInterface);
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
function unblindTransactionPrevoutsAndOutputs(
  tx: TxInterface,
  blindingPrivateKeys: string[]
): TxInterface {
  // try to unblind prevouts, if success replace blinded prevout by unblinded prevout
  for (let inputIndex = 0; inputIndex < tx.vin.length; inputIndex++) {
    const prevout = tx.vin[inputIndex].prevout;
    if (isBlindedOutputInterface(prevout)) {
      for (let i = 0; i < blindingPrivateKeys.length; i++) {
        try {
          const unblindOutput = tryToUnblindOutput(
            prevout,
            blindingPrivateKeys[i]
          );
          tx.vin[inputIndex].prevout = unblindOutput;
          break;
        } catch (_) {
          continue;
        }
      }
    }
  }

  // try to unblind outputs
  for (let outputIndex = 0; outputIndex < tx.vout.length; outputIndex++) {
    const output = tx.vout[outputIndex];
    if (isBlindedOutputInterface(output)) {
      for (let i = 0; i < blindingPrivateKeys.length; i++) {
        try {
          const unblindOutput = tryToUnblindOutput(
            output,
            blindingPrivateKeys[i]
          );
          tx.vout[outputIndex] = unblindOutput;
          break;
        } catch (_) {
          continue;
        }
      }
    }
  }

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
    asset: unblindedResult.asset.reverse().toString('hex'),
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
    try {
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
    } catch (err) {
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
