import { TxOutput, confidential } from 'liquidjs-lib';

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

export interface UtxoInterface {
  txid: string;
  vout: number;
  asset?: string;
  value?: number;
  prevout?: TxOutput;
  unblindData?: confidential.UnblindOutputResult;
  redeemScript?: Buffer;
  witnessScript?: Buffer;
}

export interface BlindedOutputInterface {
  script: string;
  blindedValue: Buffer;
  blindedAsset: Buffer;
  nonce: Buffer;
  rangeProof: Buffer;
  surjectionProof: Buffer;
}

export function isBlindedOutputInterface(
  object: any
): object is BlindedOutputInterface {
  return 'surjectionProof' in object && 'rangeProof' in object;
}

export interface UnblindedOutputInterface {
  script: string;
  value: number;
  asset: string;
  valueBlinder: string;
  assetBlinder: string;
}

export interface InputInterface {
  txid: string;
  vout: number;
  prevout?: BlindedOutputInterface | UnblindedOutputInterface;
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
  vout: (BlindedOutputInterface | UnblindedOutputInterface)[];
}

export type CompareUtxoFn = (a: UtxoInterface, b: UtxoInterface) => number;

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
