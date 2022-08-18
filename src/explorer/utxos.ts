import ECPairFactory, { TinySecp256k1Interface } from 'ecpair';
import { address } from 'liquidjs-lib';
import UnblindError from '../error/unblind-error';
import {
  AddressInterface,
  InputInterface,
  TxInterface,
  UnblindedOutput,
  Output,
} from '../types';
import { unblindOutput } from '../utils';
import { fetchUtxos } from './esplora';

/**
 * fetchAndUnblindUtxosGenerator returns the unblinded utxos associated with a set of addresses.
 * @param addressesAndBlindingKeys the set of addresses with blinding key (if confidential)
 * @param url esplora URL
 * @param skip optional, using to skip blinding step
 */
export async function* fetchAndUnblindUtxosGenerator(
  ecclib: TinySecp256k1Interface,
  addressesAndBlindingKeys: AddressInterface[],
  url: string,
  skip?: (utxo: Output) => boolean
): AsyncGenerator<
  UnblindedOutput,
  { numberOfUtxos: number; errors: Error[] },
  undefined
> {
  let numberOfUtxos = 0;
  const errors = [];

  // the generator repeats the process for each addresses
  for (const {
    confidentialAddress,
    blindingPrivateKey,
  } of addressesAndBlindingKeys) {
    try {
      // check the blinding private key
      if (blindingPrivateKey.length > 0) {
        const blindingKeyPair = ECPairFactory(ecclib).fromPrivateKey(
          Buffer.from(blindingPrivateKey, 'hex')
        );
        const addressPublicKey = address.fromConfidential(confidentialAddress)
          .blindingKey;
        if (!blindingKeyPair.publicKey.equals(addressPublicKey)) {
          throw new Error('wrong blinding private key');
        }
      }

      // fetch the unspents
      const blindedUtxos = await fetchUtxos(confidentialAddress, url);

      // at each 'next' call, the generator will return the result of the next promise
      for (const blindedUtxo of blindedUtxos) {
        if (skip?.(blindedUtxo)) continue;

        yield await tryToUnblindUtxo(blindedUtxo, blindingPrivateKey);
        numberOfUtxos++;
      }
    } catch (err) {
      if (err instanceof Error) errors.push(err);
      if (typeof err === 'string') errors.push(new Error(err));
      errors.push(new Error('unknow error'));
    }
  }
  return { numberOfUtxos, errors };
}

// Aggregate generator's result.
export async function fetchAndUnblindUtxos(
  ecclib: TinySecp256k1Interface,
  addressesAndBlindingKeys: AddressInterface[],
  url: string,
  skip?: (utxo: Output) => boolean
): Promise<UnblindedOutput[]> {
  const utxosGenerator = fetchAndUnblindUtxosGenerator(
    ecclib,
    addressesAndBlindingKeys,
    url,
    skip
  );
  const utxos: UnblindedOutput[] = [];

  let iterator = await utxosGenerator.next();
  while (!iterator.done) {
    utxos.push(iterator.value);
    iterator = await utxosGenerator.next();
  }

  return utxos;
}

/**
 * try to unblind the utxo with blindPrivKey. if unblind fails, return utxo
 * if unblind step success: set prevout & unblindData members in UtxoInterface result
 * @param utxo utxo to unblind
 * @param blindPrivKey the blinding private key using to unblind
 * @param url esplora endpoint URL
 */
export async function tryToUnblindUtxo(
  utxo: Output,
  blindPrivKey: string
): Promise<UnblindedOutput> {
  try {
    return unblindOutput(utxo, blindPrivKey);
  } catch (_) {
    throw new UnblindError(utxo.txid, utxo.vout, blindPrivKey);
  }
}

/**
 * Reduce a set of transactions using a set of scripts
 * @param txs the wallet's transactions
 * @param walletScripts the set of scripts to use in order to filter tx's outputs
 * @param initialState initial utxos state (set in txs reducer) - optional (default: [])
 */
export function utxosFromTransactions(
  txs: TxInterface[],
  walletScripts: Set<string>,
  initialState: (Output | UnblindedOutput)[] = []
): (Output | UnblindedOutput)[] {
  const orInfinity = (a?: number) => (a ? a : Infinity);
  const compareBlockHeight = (a: TxInterface, b: TxInterface) =>
    orInfinity(a.status.blockHeight) - orInfinity(b.status.blockHeight) || 0;
  const compareVin = (a: TxInterface, b: TxInterface) =>
    a.vin.map(i => i.txid).includes(b.txid) ? 1 : -1;
  const compare = (a: TxInterface, b: TxInterface) =>
    compareBlockHeight(a, b) || compareVin(a, b);
  return txs
    .sort(compare)
    .reduce((utxoSet: (Output | UnblindedOutput)[], tx: TxInterface, _) => {
      const withoutSpentUtxo = removeInputsFromUtxos(utxoSet, tx.vin);
      return addOutputsToUtxos(withoutSpentUtxo, tx, walletScripts);
    }, initialState);
}

function addOutputsToUtxos(
  utxos: (Output | UnblindedOutput)[],
  tx: TxInterface,
  walletScripts: Set<string>
) {
  const isWalletOutput = (o: Output) =>
    walletScripts.has(o.prevout.script.toString('hex'));
  const walletOutputs = tx.vout.filter(isWalletOutput);
  return utxos.concat(walletOutputs);
}

function removeInputsFromUtxos(utxoSet: Output[], inputs: InputInterface[]) {
  let result = utxoSet;
  for (const input of inputs) {
    result = result.filter(
      u => !(u.txid === input.txid && u.vout === input.vout)
    );
  }

  return result;
}
