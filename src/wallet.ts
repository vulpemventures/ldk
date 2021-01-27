import { Network, networks, address, Psbt } from 'liquidjs-lib';
import { AddressInterface, UtxoInterface, Outpoint } from './types';
import { toOutpoint } from './utils';

/**
 * Wallet abstraction.
 */
export interface WalletInterface {
  network: Network;
  addresses: AddressInterface[];
  blindingPrivateKeyByScript: Record<string, Buffer>;
  createTx(): string;
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
