import { BIP32Interface, fromBase58, fromPublicKey, fromSeed } from 'bip32';
import { mnemonicToSeedSync } from 'bip39';
import { networks } from 'liquidjs-lib';
import { BlindingDataLike } from 'liquidjs-lib/types/psbt';

import { blindingKeyFromXPubs, p2msPayment } from '../p2ms';
import {
  AddressInterface,
  MultisigPayment,
  CosignerMultisig,
  XPub,
} from '../types';
import { IdentityType } from '../types';
import { checkIdentityType, checkMasterPublicKey, toXpub } from '../utils';

import { IdentityInterface, IdentityOpts } from './identity';
import { Identity } from './identity';

export const DEFAULT_BASE_DERIVATION_PATH = "m/48'/0'/0'/2'"; // --> bip48

/**
 * the public keys required to sign are defined by cosignersPublicKeys (xpub)
 * the required number of signature must be < length of cosigners xpubs
 */
export interface MultisigWatchOnlyOpts {
  cosigners: CosignerMultisig[];
  requiredSignatures: number;
}

export class MultisigWatchOnly extends Identity implements IdentityInterface {
  private nextIndex = 0;
  private nextChangeIndex = 0;

  static EXTERNAL_INDEX = 0;
  static INTERNAL_INDEX = 1; // change addresses

  cosigners: BIP32Interface[];
  requiredSignatures: number;

  constructor(args: IdentityOpts<MultisigWatchOnlyOpts>) {
    super(args);
    checkIdentityType(args.type, IdentityType.MultisigWatchOnly);
    checkRequiredSignature(
      args.opts.requiredSignatures,
      args.opts.cosigners.length
    );

    const cosignersPublicKeys = args.opts.cosigners.map(cosigner =>
      cosignerToXPub(cosigner, this.network)
    );
    cosignersPublicKeys.forEach(checkMasterPublicKey);

    this.cosigners = cosignersPublicKeys.sort().map(xpub => fromBase58(xpub));

    this.requiredSignatures = args.opts.requiredSignatures;
  }

  getNextAddress() {
    const addr = this.getMultisigAddress(
      MultisigWatchOnly.EXTERNAL_INDEX,
      this.nextIndex
    );
    this.nextIndex++;
    return Promise.resolve(addr);
  }

  getNextChangeAddress() {
    const addr = this.getMultisigAddress(
      MultisigWatchOnly.INTERNAL_INDEX,
      this.nextChangeIndex
    );
    this.nextChangeIndex++;
    return Promise.resolve(addr);
  }

  getAddresses(): Promise<AddressInterface[]> {
    const externals = Array.from(Array(this.nextIndex).keys()).map(index =>
      this.getMultisigAddress(MultisigWatchOnly.EXTERNAL_INDEX, index)
    );
    const internals = Array.from(
      Array(this.nextChangeIndex).keys()
    ).map(index =>
      this.getMultisigAddress(MultisigWatchOnly.INTERNAL_INDEX, index)
    );

    return Promise.resolve(externals.concat(internals));
  }

  getBlindingPrivateKey(script: string): Promise<string> {
    const privKey = this.getBlindingKeyPair(script).privateKey;
    return Promise.resolve(privKey.toString('hex'));
  }

  private getBlindingKeyPair(script: string) {
    const keys = blindingKeyFromXPubs(this.cosigners).derive(script);
    if (!keys.publicKey || !keys.privateKey)
      throw new Error('unable to generate blinding key pair');
    return { publicKey: keys.publicKey, privateKey: keys.privateKey };
  }

  isAbleToSign(): boolean {
    return false;
  }

  signPset(_: string): Promise<string> {
    throw new Error('WatchOnly Multisig Identity is not able to sign pset');
  }

  blindPset(
    psetBase64: string,
    outputsIndexToBlind: number[],
    outputsPubKeysByIndex?: Map<number, string>,
    inputsBlindingDataLike?: Map<number, BlindingDataLike>
  ): Promise<string> {
    return super.blindPsetWithBlindKeysGetter(
      (script: Buffer) => this.getBlindingKeyPair(script.toString('hex')),
      psetBase64,
      outputsIndexToBlind,
      outputsPubKeysByIndex,
      inputsBlindingDataLike
    );
  }

  getMultisigAddress(change: number, index: number): MultisigPayment {
    const keys = this.cosigners.map(cosigner =>
      cosigner.derive(change).derive(index)
    );

    const payment = p2msPayment(
      keys,
      blindingKeyFromXPubs(this.cosigners),
      this.requiredSignatures,
      this.network
    );

    return { ...payment, derivationPath: `${change}/${index}` };
  }
}

function checkRequiredSignature(required: number, cosignersLength: number) {
  if (required <= 0 || required > cosignersLength) {
    throw new Error(
      `number of required signatures must be > 0 and <= ${cosignersLength}`
    );
  }
}

function cosignerToXPub(
  cosigner: CosignerMultisig,
  network: networks.Network
): XPub {
  if (typeof cosigner === 'string') return cosigner;

  const walletSeed = mnemonicToSeedSync(cosigner.mnemonic);
  const baseNode = fromSeed(walletSeed, network).derivePath(
    cosigner.baseDerivationPath || DEFAULT_BASE_DERIVATION_PATH
  );
  return toXpub(
    fromPublicKey(baseNode.publicKey, baseNode.chainCode, network).toBase58()
  );
}
