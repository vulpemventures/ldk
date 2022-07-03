import { TxOutput, confidential } from 'liquidjs-lib';
import { isConfidentialOutput } from './utils';

/**
 * Enumeration of all the Identity types.
 */
export enum IdentityType {
  PrivateKey = 1,
  Mnemonic,
  MasterPublicKey,
  Inject,
  Ledger,
  Trezor,
  MultisigWatchOnly,
  Multisig,
}

/**
 * Defines the shape of the object returned by the getAdresses's method.
 * @member confidentialAddress the confidential address.
 * @member blindingPrivateKey the blinding private key associated to the confidential address.
 */
export interface AddressInterface {
  confidentialAddress: string;
  blindingPrivateKey: string;
  derivationPath?: string;
  publicKey?: string;
  [key: string]: any;
}

// define a type using to implement change's address strategy
export type ChangeAddressFromAssetGetter = (asset: string) => string;

// define function that takes a script as input and returns a blinding key (or undefined)
export type BlindingKeyGetter = (script: string) => string | undefined;

export interface RecipientInterface {
  value: number;
  asset: string;
  address: string;
}

export interface Outpoint {
  txid: string;
  vout: number;
}

export type Output = Outpoint & {
  prevout: TxOutput;
};

export type UnblindedOutput = Output & {
  unblindData: confidential.UnblindOutputResult;
};

export function isUnblindedOutput(output: Output): output is UnblindedOutput {
  return (output as UnblindedOutput).unblindData !== undefined;
}

export function getSats(output: Output | UnblindedOutput): number {
  if (isUnblindedOutput(output)) return parseInt(output.unblindData.value, 10);
  if (!isConfidentialOutput(output.prevout)) {
    return confidential.confidentialValueToSatoshi(output.prevout.value);
  }

  throw new Error(
    'cannot get value for confidential output, need unblinded one'
  );
}

export function getAsset(output: Output | UnblindedOutput): string {
  if (isUnblindedOutput(output)) {
    const asset = Buffer.from(output.unblindData.asset).reverse();
    return asset.toString('hex');
  }

  if (!isConfidentialOutput(output.prevout)) {
    const asset = Buffer.from(output.prevout.asset)
      .slice(1)
      .reverse();
    return asset.toString('hex');
  }

  throw new Error(
    'cannot get asset for confidential output, need unblinded one'
  );
}

export interface InputInterface {
  txid: string;
  vout: number;
  prevout?: Output | UnblindedOutput;
  isPegin: boolean;
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
  vin: InputInterface[];
  vout: (Output | UnblindedOutput)[];
}

export type CoinSelectorErrorFn = (
  asset: string,
  need: number,
  has: number
) => void;

export type MultisigPayment = AddressInterface & {
  witnessScript: string;
};

export interface HDSignerMultisig {
  mnemonic: string;
  passphrase?: string;
  baseDerivationPath?: string;
}

export type XPub = string;

export type CosignerMultisig = XPub | HDSignerMultisig; // xpub or signer

export type NetworkString = 'regtest' | 'testnet' | 'liquid';
