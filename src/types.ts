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

export function sats(output: Output | UnblindedOutput): number {
  if (!isConfidentialOutput(output.prevout)) {
    return confidential.confidentialValueToSatoshi(output.prevout.value);
  }

  if (isUnblindedOutput(output)) return parseInt(output.unblindData.value, 10);

  throw new Error(
    'cannot get value for confidential output, need unblinded one'
  );
}

function assetToHex(buf: Buffer): string {
  return buf
    .slice()
    .reverse()
    .toString('hex');
}

export function asset(output: Output | UnblindedOutput): string {
  if (!isConfidentialOutput(output.prevout)) {
    return assetToHex(output.prevout.asset.slice(1));
  }

  if (isUnblindedOutput(output)) {
    return assetToHex(output.unblindData.asset);
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
  baseDerivationPath?: string;
}

export type XPub = string;

export type CosignerMultisig = XPub | HDSignerMultisig; // xpub or signer

export type NetworkString = 'regtest' | 'testnet' | 'liquid';
