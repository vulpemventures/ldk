import { Psbt } from 'liquidjs-lib';
import { CoinSelector } from './coinselection/coinSelector';
import {
  AddressInterface,
  RecipientInterface,
  ChangeAddressFromAssetGetter,
  NetworkString,
  UnblindedOutput,
} from './types';
import { getNetwork } from './utils';
import {
  craftMultipleRecipientsPset,
  BuildTxArgs,
  DEFAULT_SATS_PER_BYTE,
  craftSingleRecipientPset,
} from './transaction';
import { fetchAndUnblindUtxos } from './explorer/utxos';
import { Network } from 'liquidjs-lib/src/networks';

/**
 * Wallet abstraction.
 */
export interface WalletInterface {
  network: Network;
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
 * @method createTx init empty PSET.
 * @method updateTx update a PSET with outputs and inputs (for Swap tx).
 */
export class Wallet implements WalletInterface {
  network: Network;
  unspents: UnblindedOutput[];

  constructor(unspents: UnblindedOutput[], network: Network) {
    this.network = network;
    this.unspents = unspents;
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
      unspents: this.unspents,
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
      this.unspents,
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
  network?: NetworkString
): Promise<WalletInterface> {
  const utxos = await fetchAndUnblindUtxos(addresses, explorerUrl);
  return walletFromCoins(utxos, network);
}

export function walletFromCoins(
  coins: UnblindedOutput[],
  network?: NetworkString
): WalletInterface {
  return new Wallet(coins, getNetwork(network));
}
