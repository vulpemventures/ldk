import { BIP32Interface, fromBase58 } from 'bip32';
import { BlindingDataLike } from 'liquidjs-lib/types/psbt';
import { blindingKeyFromXPubs, p2msPayment } from '../p2ms';
import { AddressInterface, MultisigPayment } from '../types';
import { checkIdentityType, checkMasterPublicKey } from '../utils';
import Identity, {
  IdentityInterface,
  IdentityOpts,
  IdentityType,
} from './identity';

/**
 * the public keys required to sign are defined by cosignersPublicKeys (xpub)
 * the required number of signature must be < length of cosigners xpubs
 */
export interface MultisigWatchOnlyOpts {
  cosignersPublicKeys: string[];
  requiredSignatures: number;
}

export class MultisigWatchOnly extends Identity implements IdentityInterface {
  private nextIndex: number = 0;
  private nextChangeIndex: number = 0;

  static EXTERNAL_INDEX = 0;
  static INTERNAL_INDEX = 1; // change addresses

  cosigners: BIP32Interface[];
  requiredSignatures: number;

  constructor(args: IdentityOpts<MultisigWatchOnlyOpts>) {
    super(args);
    checkIdentityType(args.type, IdentityType.MultisigWatchOnly);
    checkRequiredSignature(
      args.opts.requiredSignatures,
      args.opts.cosignersPublicKeys
    );
    args.opts.cosignersPublicKeys.forEach(checkMasterPublicKey);

    this.cosigners = args.opts.cosignersPublicKeys
      .sort()
      .map(xpub => fromBase58(xpub));
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

function checkRequiredSignature(required: number, cosigners: string[]) {
  if (required <= 0 || required > cosigners.length) {
    throw new Error(
      `number of required signatures must be > 0 and <= ${cosigners.length}`
    );
  }
}
