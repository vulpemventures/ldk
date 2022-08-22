import { confidential } from 'liquidjs-lib';
import {
  BlindingKeyGetterAsync,
  Output,
  TxInterface,
  UnblindedOutput,
} from '../types';
import { isConfidentialOutput } from '../utils';
import { ChainAPI } from './api';
import { unblindTransaction } from './transaction';
import { tryToUnblindUtxo } from './utxos';

export async function* utxosFetchGenerator(
  addresses: string[],
  blindingKeyGetter: BlindingKeyGetterAsync,
  api: ChainAPI,
  skip?: (utxo: Output) => boolean
): AsyncGenerator<
  UnblindedOutput,
  { numberOfUtxos: number; errors: Error[] },
  undefined
> {
  let numberOfUtxos = 0;
  const errors = [];
  const utxos = await api.fetchUtxos(addresses);
  for (const utxo of utxos) {
    if (skip?.(utxo)) continue;
    try {
      if (!isConfidentialOutput(utxo.prevout)) {
        yield {
          ...utxo,
          unblindData: {
            asset: utxo.prevout.asset.slice(1),
            value: confidential
              .confidentialValueToSatoshi(utxo.prevout.value)
              .toString(10),
            assetBlindingFactor: Buffer.alloc(32),
            valueBlindingFactor: Buffer.alloc(32),
          },
        };
      }

      const privateBlindingKey = await blindingKeyGetter(
        utxo.prevout.script.toString('hex')
      );
      if (!privateBlindingKey) {
        // do not unblind, just skip and continue
        continue;
      }

      const unblindedUtxo = await tryToUnblindUtxo(utxo, privateBlindingKey);
      yield unblindedUtxo;
      numberOfUtxos++;
    } catch (err) {
      console.log(err);
      if (err instanceof Error) {
        errors.push(err);
      }

      if (typeof err === 'string') {
        errors.push(new Error(err));
      }
      errors.push(new Error('unknown error'));
    }
  }

  return { numberOfUtxos, errors };
}

export async function* txsFetchGenerator(
  addresses: string[],
  blindingKeyGetter: BlindingKeyGetterAsync,
  api: ChainAPI,
  skip?: (tx: TxInterface) => boolean
): AsyncGenerator<
  TxInterface,
  { txIDs: string[]; errors: Error[] },
  undefined
> {
  const txIDs: string[] = [];
  const errors: Error[] = [];
  const transactions = await api.fetchTxs(addresses);
  for (const tx of transactions) {
    if (skip?.(tx)) continue;
    try {
      const { unblindedTx, errors: errs } = await unblindTransaction(
        tx,
        blindingKeyGetter
      );
      errors.push(...errs);
      yield unblindedTx;

      txIDs.push(tx.txid);
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

export async function fetchAllTxs(
  addresses: string[],
  blindingKeyGetter: BlindingKeyGetterAsync,
  api: ChainAPI,
  skip?: (tx: TxInterface) => boolean
): Promise<TxInterface[]> {
  const txs: TxInterface[] = [];
  for await (const tx of txsFetchGenerator(
    addresses,
    blindingKeyGetter,
    api,
    skip
  )) {
    txs.push(tx);
  }
  return txs;
}

export async function fetchAllUtxos(
  addresses: string[],
  blindingKeyGetter: BlindingKeyGetterAsync,
  api: ChainAPI,
  skip?: (utxo: Output) => boolean
): Promise<UnblindedOutput[]> {
  const utxos: UnblindedOutput[] = [];
  for await (const utxo of utxosFetchGenerator(
    addresses,
    blindingKeyGetter,
    api,
    skip
  )) {
    utxos.push(utxo);
  }
  return utxos;
}
