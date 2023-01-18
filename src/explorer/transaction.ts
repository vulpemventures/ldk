import axios from 'axios';
import UnblindError from '../error/unblind-error';
import {
  BlindingKeyGetter,
  BlindingKeyGetterAsync,
  isUnblindedOutput,
  TxInterface,
} from '../types';
import { isConfidentialOutput, unblindOutput } from '../utils';
import { esploraTxToTxInterface } from './esplora';
import { EsploraTx } from './types';
import { ZKPInterface } from 'liquidjs-lib/src/confidential';

/**
 * Return an async generator fetching and unblinding addresses' transactions
 * @param addresses
 * @param blindingKeyGetter
 * @param explorerUrl
 * @param zkplib
 * @param skip optional, can be used to skip certain transaction
 */
export async function* fetchAndUnblindTxsGenerator(
  addresses: string[],
  blindingKeyGetter: BlindingKeyGetter,
  explorerUrl: string,
  zkplib: ZKPInterface,
  skip?: (tx: TxInterface) => boolean
): AsyncGenerator<
  TxInterface,
  { txIDs: string[]; errors: Error[] },
  undefined
> {
  const txIDs: string[] = [];
  const errors: Error[] = [];

  for (const address of addresses) {
    try {
      const txsGenerator = fetchTxsGenerator(address, explorerUrl, skip);
      let txIterator = await txsGenerator.next();
      while (!txIterator.done) {
        const tx = txIterator.value;
        if (txIDs.includes(tx.txid)) {
          txIterator = await txsGenerator.next();
          continue;
        }

        const { unblindedTx, errors: errs } = await unblindTransaction(
          tx,
          async (script: string) => blindingKeyGetter(script),
          zkplib
        );
        errors.push(...errs);
        yield unblindedTx;

        txIDs.push(tx.txid);
        txIterator = await txsGenerator.next();
      }
    } catch (err) {
      if (err instanceof Error) {
        errors.push(err);
      }

      if (typeof err === 'string') {
        errors.push(new Error(err));
      }

      errors.push(new Error('unknown error'));
    }
  }
  return { txIDs, errors };
}

/**
 * Use FetchAndUnblindTxsGenerator to get all utxos for a set of addresses
 * @param addresses
 * @param blindingKeyGetter
 * @param explorerUrl
 * @param zkplib
 * @param skip optional
 */
export async function fetchAndUnblindTxs(
  addresses: string[],
  blindingKeyGetter: BlindingKeyGetter,
  explorerUrl: string,
  zkplib: ZKPInterface,
  skip?: (tx: TxInterface) => boolean
): Promise<TxInterface[]> {
  const generator = fetchAndUnblindTxsGenerator(
    addresses,
    blindingKeyGetter,
    explorerUrl,
    zkplib,
    skip
  );

  const txs: TxInterface[] = [];

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
 * @param skip
 */
async function* fetchTxsGenerator(
  address: string,
  explorerUrl: string,
  skip?: (tx: TxInterface) => boolean
): AsyncGenerator<TxInterface, number, undefined> {
  let lastSeenTxid = undefined;
  let newTxs: EsploraTx[] = [];
  let numberOfTxs = 0;

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
      if (skip?.(transaction)) {
        continue;
      }
      yield transaction;
    }
  } while (lastSeenTxid);

  return numberOfTxs;
}

/**
 * takes the TxInterface and try to transform BlindedOutputInterface to UnblindedOutputInterface (prevouts & outputs)
 * @param tx transaction to unblind
 * @param blindingPrivateKeyGetter
 * @param zkplib
 */
export async function unblindTransaction(
  tx: TxInterface,
  blindingPrivateKeyGetter: BlindingKeyGetterAsync,
  zkplib: ZKPInterface
): Promise<{ unblindedTx: TxInterface; errors: UnblindError[] }> {
  const promises: Promise<void>[] = [];
  const errors: UnblindError[] = [];

  // try to unblind prevouts, if success replace blinded prevout by unblinded prevout
  for (let inputIndex = 0; inputIndex < tx.vin.length; inputIndex++) {
    const output = tx.vin[inputIndex].prevout;
    if (output && isConfidentialOutput(output.prevout)) {
      const promise = async () => {
        const blindingKey = await blindingPrivateKeyGetter(
          output.prevout.script.toString('hex')
        );
        if (blindingKey) {
          try {
            tx.vin[inputIndex].prevout = await unblindOutput(
              output,
              blindingKey,
              zkplib
            );
          } catch (_) {
            errors.push(
              new UnblindError(
                tx.vin[inputIndex].txid,
                tx.vin[inputIndex].vout,
                blindingKey
              )
            );
          }
        }
      };

      promises.push(promise());
    }
  }

  // try to unblind outputs
  for (let outputIndex = 0; outputIndex < tx.vout.length; outputIndex++) {
    const output = tx.vout[outputIndex];
    if (!isUnblindedOutput(output)) {
      const promise = async () => {
        const blindingKey = await blindingPrivateKeyGetter(
          output.prevout.script.toString('hex')
        );
        if (blindingKey) {
          try {
            tx.vout[outputIndex] = await unblindOutput(
              output,
              blindingKey,
              zkplib
            );
          } catch (err) {
            errors.push(new UnblindError(tx.txid, outputIndex, blindingKey));
          }
        }
      };

      promises.push(promise());
    }
  }

  await Promise.all(promises);

  return { unblindedTx: tx, errors };
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
