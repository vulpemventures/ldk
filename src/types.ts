import { TxOutput, confidential } from 'liquidjs-lib';

/**
 * Defines the shape of the object returned by the getAdresses's method.
 * @member confidentialAddress the confidential address.
 * @member blindingPrivateKey the blinding private key associated to the confidential address.
 */
export interface AddressInterface {
  confidentialAddress: string;
  blindingPrivateKey: string;
}

// define a type using to implement change's address strategy
export type ChangeAddressFromAssetGetter = (
  asset: string
) => string | undefined;

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
}

export interface InputInterface {
  txid: string;
  vout: number;
  prevout: BlindedOutputInterface | UnblindedOutputInterface;
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
  vin: Array<InputInterface>;
  vout: Array<BlindedOutputInterface | UnblindedOutputInterface>;
}
