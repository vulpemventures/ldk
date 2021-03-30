import axios from 'axios';
import {
  BlindingKeyGetter,
  isBlindedOutputInterface,
  TxInterface,
} from '../types';
import { unblindOutput } from '../utils';
import { esploraTxToTxInterface } from './esplora';
import { EsploraTx } from './types';

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

      try {
        yield unblindTransaction(tx, blindingKeyGetter);
        txids.push(tx.txid);
      } catch (err) {
        console.error(
          `an error occurs during unblinding step for tx ${tx.txid}`
        );
      }
      txIterator = await txsGenerator.next();
    }
  }
  return;
}

/**
 * Use FetchAndUnblindTxsGenerator to get all utxos for a set of addresses
 * @param addresses
 * @param blindingKeyGetter
 * @param explorerUrl
 * @param skip optional
 */
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

/**
 * takes the a TxInterface and try to transform BlindedOutputInterface to UnblindedOutputInterface (prevouts & outputs)
 * @param tx transaction to unblind
 * @param blindingPrivateKeys the privateKeys using to unblind the outputs.
 */
export async function unblindTransaction(
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
