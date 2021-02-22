import {
  AddressInterface,
  BlindedOutputInterface,
  BlindingKeyGetter,
  InputInterface,
  TxInterface,
  UnblindedOutputInterface,
  UtxoInterface,
  isBlindedOutputInterface,
} from '../types';
import { Transaction, TxOutput, confidential } from 'liquidjs-lib';
import { isConfidentialOutput, toAssetHash, toNumber } from '../utils';
import { EsploraTx } from './types';
import axios from 'axios';

export async function fetchBalances(
  address: string,
  blindPrivKey: string,
  url: string
) {
  const utxoInterfaces = await fetchAndUnblindUtxos(
    [{ confidentialAddress: address, blindingPrivateKey: blindPrivKey }],
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

export async function fetchTxHex(txId: string, url: string): Promise<string> {
  return (await axios.get(`${url}/tx/${txId}/hex`)).data;
}

export async function fetchUtxos(address: string, url: string): Promise<any[]> {
  return (await axios.get(`${url}/address/${address}/utxo`)).data;
}

export async function fetchAndUnblindTxs(
  addresses: string[],
  blindingKeyGetter: BlindingKeyGetter,
  explorerUrl: string,
  skip?: (tx: TxInterface) => boolean
): Promise<TxInterface[]> {
  const generator = fetchAndUnblindTxsGenerator(
    addresses,
    blindingKeyGetter,
    explorerUrl,
    skip
  );
  const txs: Array<TxInterface> = [];

  let iterator = await generator.next();
  while (!iterator.done) {
    txs.push(iterator.value);
    iterator = await generator.next();
  }

  return txs;
}

export async function* fetchAndUnblindUtxosGenerator(
  addressesAndBlindingKeys: Array<AddressInterface>,
  url: string,
  skip?: (utxo: UtxoInterface) => boolean
): AsyncGenerator<UtxoInterface, number, undefined> {
  let numberOfUtxos = 0;

  // the generator repeats the process for each addresses
  for (const {
    confidentialAddress,
    blindingPrivateKey,
  } of addressesAndBlindingKeys) {
    const blindedUtxos = await fetchUtxos(confidentialAddress, url);
    const unblindedUtxosPromises = blindedUtxos.map((utxo: UtxoInterface) => {
      if (skip && skip(utxo)) {
        return utxo;
      }

      // this is a non blocking function, returning the base utxo if the unblind failed
      return fetchPrevoutAndTryToUnblindUtxo(utxo, blindingPrivateKey, url);
    });

    // increase the number of utxos
    numberOfUtxos += unblindedUtxosPromises.length;

    // at each 'next' call, the generator will return the result of the next promise
    for (const promise of unblindedUtxosPromises) {
      const r = await promise;
      yield r;
    }
  }

  return numberOfUtxos;
}

export async function fetchAndUnblindUtxos(
  addressesAndBlindingKeys: Array<AddressInterface>,
  url: string,
  skip?: (utxo: UtxoInterface) => boolean
): Promise<UtxoInterface[]> {
  const utxosGenerator = fetchAndUnblindUtxosGenerator(
    addressesAndBlindingKeys,
    url,
    skip
  );
  const utxos: UtxoInterface[] = [];

  let iterator = await utxosGenerator.next();
  while (!iterator.done) {
    utxos.push(iterator.value);
    iterator = await utxosGenerator.next();
  }

  return utxos;
}

/**
 * Return an async generator fetching and unblinding addresses' transactions
 * @param addresses
 * @param blindingKeyGetter
 * @param explorerUrl
 * @param skip optional, can be used to skip certain transaction
 */
export async function* fetchAndUnblindTxsGenerator(
  addresses: string[],
  blindingKeyGetter: BlindingKeyGetter,
  explorerUrl: string,
  skip?: (tx: TxInterface) => boolean
): AsyncGenerator<TxInterface, void, undefined> {
  const txids: string[] = [];
  for (const address of addresses) {
    const txsGenerator = fetchTxsGenerator(address, explorerUrl, skip);
    let txIterator = await txsGenerator.next();
    while (!txIterator.done) {
      const tx = txIterator.value;
      if (txids.includes(tx.txid)) {
        txIterator = await txsGenerator.next();
        continue;
      }

      txids.push(tx.txid);
      yield unblindTransactionPrevoutsAndOutputs(tx, blindingKeyGetter);
      txIterator = await txsGenerator.next();
    }
  }
  return;
}

/**
 * Fetch all the txs associated to a given address and unblind them using the blindingPrivateKey.
 * @param address the confidential address
 * @param explorerUrl the Esplora URL API using to fetch blockchain data.
 */
async function* fetchTxsGenerator(
  address: string,
  explorerUrl: string,
  skip?: (tx: TxInterface) => boolean
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

    if (newTxs.length === 0) break;
    lastSeenTxid = newTxs[newTxs.length - 1].txid;
    numberOfTxs += newTxs.length;

    // convert them into txInterface
    const txs: Promise<TxInterface>[] = newTxs.map(tx =>
      esploraTxToTxInterface(tx, explorerUrl)
    );

    for (const tx of txs) {
      const transaction = await tx;
      if (skip && skip(transaction)) {
        continue;
      }
      yield transaction;
    }
  } while (lastSeenTxid);

  return numberOfTxs;
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
          const unblinded = await unblindOutput(prevout, blindingKey);
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
          const unblinded = await unblindOutput(output, blindingKey);
          tx.vout[outputIndex] = unblinded;
        }
      };

      promises.push(promise());
    }
  }

  await Promise.all(promises);

  return tx;
}

export async function unblindOutput(
  output: BlindedOutputInterface,
  BlindingPrivateKey: string
): Promise<UnblindedOutputInterface> {
  const txOutput: TxOutput = {
    asset: output.blindedAsset,
    value: output.blindedValue,
    rangeProof: output.rangeProof,
    surjectionProof: output.surjectionProof,
    nonce: output.nonce,
    script: Buffer.from(output.script, 'hex'),
  };

  const blindPrivateKeyBuffer = Buffer.from(BlindingPrivateKey, 'hex');
  const unblindedResult = await confidential.unblindOutputWithKey(
    txOutput,
    blindPrivateKeyBuffer
  );

  const unblindedOutput: UnblindedOutputInterface = {
    asset: Buffer.from(unblindedResult.asset.reverse()).toString('hex'),
    value: parseInt(unblindedResult.value, 10),
    script: output.script,
  };

  return unblindedOutput;
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

export async function utxoWithPrevout(
  utxo: UtxoInterface,
  explorerURL: string
): Promise<UtxoInterface> {
  const prevoutHex: string = await fetchTxHex(utxo.txid, explorerURL);
  const prevout = Transaction.fromHex(prevoutHex).outs[utxo.vout];

  return { ...utxo, prevout };
}

/**
 * try to unblind the utxo with blindPrivKey. if unblind fails, return utxo
 * if unblind step success: set prevout & unblindData members in UtxoInterface result
 * @param utxo utxo to unblind
 * @param blindPrivKey the blinding private key using to unblind
 * @param url esplora endpoint URL
 */
export async function fetchPrevoutAndTryToUnblindUtxo(
  utxo: UtxoInterface,
  blindPrivKey: string,
  url: string
): Promise<UtxoInterface> {
  if (!utxo.prevout) utxo = await utxoWithPrevout(utxo, url);
  try {
    return unblindUtxo(utxo, blindPrivKey);
  } catch (_) {
    return utxo;
  }
}

export async function unblindUtxo(
  utxo: UtxoInterface,
  blindPrivKey: string
): Promise<UtxoInterface> {
  if (!utxo.prevout)
    throw new Error(
      'utxo need utxo.prevout to be defined. Use utxoWithPrevout.'
    );

  if (!isConfidentialOutput(utxo.prevout)) {
    return utxo;
  }

  const unblindData = await confidential.unblindOutputWithKey(
    utxo.prevout,
    Buffer.from(blindPrivKey, 'hex')
  );

  const unblindAsset = Buffer.alloc(32);
  unblindData.asset.copy(unblindAsset);

  return {
    ...utxo,
    asset: unblindAsset.reverse().toString('hex'),
    value: parseInt(unblindData.value, 10),
    unblindData,
  };
}
