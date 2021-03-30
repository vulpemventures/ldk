import { confidential, Transaction } from 'liquidjs-lib';
import { AddressInterface, UtxoInterface } from '../types';
import { fetchTxHex, fetchUtxos } from './esplora';
import { isConfidentialOutput } from '../utils';

/**
 * Fetch balances for a given address
 * @param address the address to fetch utxos
 * @param blindPrivKey the blinding private key (if the address is confidential one)
 * @param url esplora URL
 */
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
 * Fetch utxo's prevout and set it
 * @param utxo an unspent without prevout
 * @param explorerURL esplora URL
 */
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

/**
 * Unblind utxo using hex encoded blinding private key
 * @param utxo blinded utxo
 * @param blindPrivKey blinding private key
 */
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