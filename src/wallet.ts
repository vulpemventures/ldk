import { CoinSelector } from './coinselection/coinSelector';
import { Network, Psbt } from 'liquidjs-lib';
import {
  AddressInterface,
  UtxoInterface,
  Outpoint,
  RecipientInterface,
  ChangeAddressFromAssetGetter,
} from './types';
import { getNetwork, toOutpoint } from './utils';
import {
  craftMultipleRecipientsPset,
  BuildTxArgs,
  DEFAULT_SATS_PER_BYTE,
  craftSingleRecipientPset,
} from './transaction';
import { fetchAndUnblindUtxos } from './explorer/utxos';

/**
 * Wallet abstraction.
 */
export interface WalletInterface {
  network: Network;
  cache: UtxoCacheInterface;
  createTx(): string;
  buildTx(
    psetBase64: string,
    recipients: RecipientInterface[],
    coinSelector: CoinSelector,
    changeAddressByAsset: ChangeAddressFromAssetGetter,
    addFee?: boolean,
    satsPerByte?: number
  ): string;
  sendTx(
    recipient: RecipientInterface,
    coinSelector: CoinSelector,
    changeAddress: string,
    substractFee?: boolean,
    satsPerByte?: number
  ): string;
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
  cache: UtxoCacheInterface;

  constructor(cache: UtxoCacheInterface, network: Network) {
    this.network = network;
    this.cache = cache;
  }

  /**
   * Returns an empty liquidjs lib Psbt instance.
   */
  createTx(): string {
    const pset = new Psbt({ network: this.network });
    return pset.toBase64();
  }

  buildTx(
    psetBase64: string,
    recipients: RecipientInterface[],
    coinSelector: CoinSelector,
    changeAddressByAsset: ChangeAddressFromAssetGetter,
    addFee?: boolean,
    satsPerByte?: number
  ): string {
    const args: BuildTxArgs = {
      psetBase64,
      recipients,
      coinSelector,
      changeAddressByAsset,
      addFee,
      satsPerByte,
      unspents: this.cache.getAll(),
    };

    return craftMultipleRecipientsPset(args);
  }

  sendTx(
    recipient: RecipientInterface,
    coinSelector: CoinSelector,
    changeAddress: string,
    substractFee = false,
    satsPerByte = DEFAULT_SATS_PER_BYTE
  ) {
    return craftSingleRecipientPset(
      this.cache.getAll(),
      recipient,
      coinSelector,
      changeAddress,
      substractFee,
      satsPerByte
    );
  }
}

/**
 * Factory: list of addresses --to--> Wallet
 * @param addresses a list of addressInterface.
 * @param explorerUrl the esplora endpoint used to fetch addresses's utxos
 * @param network network type
 */
export async function walletFromAddresses(
  addresses: AddressInterface[],
  explorerUrl: string,
  network?: string
): Promise<WalletInterface> {
  const utxos = await fetchAndUnblindUtxos(addresses, explorerUrl);
  return walletFromCoins(utxos, network);
}

export function walletFromCoins(
  coins: UtxoInterface[],
  network?: string
): WalletInterface {
  return new Wallet(new UtxoCache(coins), getNetwork(network));
}

export interface UtxoCacheInterface {
  push(utxos: UtxoInterface[]): void;
  delete(outpoint: Outpoint): boolean;
  getAll(): UtxoInterface[];
}

export class UtxoCache implements UtxoCacheInterface {
  private utxoMap: Map<Outpoint, UtxoInterface> = new Map<
    Outpoint,
    UtxoInterface
  >();

  constructor(utxos?: UtxoInterface[]) {
    if (utxos) {
      this.push(utxos);
    }
  }

  push(utxos: UtxoInterface[]): void {
    for (const utxo of utxos) {
      this.utxoMap.set(toOutpoint(utxo), utxo);
    }
  }

  delete(outpoint: Outpoint): boolean {
    return this.utxoMap.delete(outpoint);
  }

  getAll(): UtxoInterface[] {
    return Array.from(this.utxoMap.values());
  }
}
