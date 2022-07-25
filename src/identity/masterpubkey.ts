import BIP32Factory, { BIP32Interface } from 'bip32';
import { BlindingDataLike, payments } from 'liquidjs-lib';
import { SLIP77Factory, Slip77Interface } from 'slip77';
import { AddressInterface, IdentityType } from '../types';
import {
  checkIdentityType,
  isValidExtendedBlindKey,
  isValidXpub,
} from '../utils';
import { Identity, IdentityInterface, IdentityOpts } from './identity';

export interface MasterPublicKeyOpts {
  masterPublicKey: string;
  masterBlindingKey: string;
  baseDerivationPath?: string;
}

interface AddressInterfaceExtended {
  address: AddressInterface;
  publicKey: string;
}

export class MasterPublicKey extends Identity implements IdentityInterface {
  protected static INITIAL_BASE_PATH = "m/84'/0'/0'";
  static INITIAL_INDEX = 0;

  private index: number = MasterPublicKey.INITIAL_INDEX;
  private changeIndex: number = MasterPublicKey.INITIAL_INDEX;
  protected scriptToAddressCache: Record<string, AddressInterfaceExtended> = {};
  private baseDerivationPath: string;

  readonly masterPublicKeyNode: BIP32Interface;
  readonly masterBlindingKeyNode: Slip77Interface;

  constructor(args: IdentityOpts<MasterPublicKeyOpts>) {
    super(args);

    // check the identity type
    checkIdentityType(args.type, IdentityType.MasterPublicKey);

    // validate xpub
    if (!isValidXpub(args.opts.masterPublicKey)) {
      throw new Error('Master public key is not valid');
    }
    // validate master blinding key
    if (!isValidExtendedBlindKey(args.opts.masterBlindingKey)) {
      throw new Error('Master blinding key is not valid');
    }

    this.masterPublicKeyNode = BIP32Factory(args.ecclib).fromBase58(
      args.opts.masterPublicKey
    );
    this.masterBlindingKeyNode = SLIP77Factory(
      args.ecclib
    ).fromMasterBlindingKey(args.opts.masterBlindingKey);
    this.baseDerivationPath =
      args.opts.baseDerivationPath || MasterPublicKey.INITIAL_BASE_PATH;
  }

  async blindPset(
    psetBase64: string,
    outputsToBlind: number[],
    outputsPubKeys?: Map<number, string>,
    inputsBlindingDataLike?: Map<number, BlindingDataLike>
  ): Promise<string> {
    return super.blindPsetWithBlindKeysGetter(
      (script: Buffer) => this.getBlindingKeyPair(script.toString('hex'), true),
      psetBase64,
      outputsToBlind,
      outputsPubKeys,
      inputsBlindingDataLike
    );
  }

  isAbleToSign(): boolean {
    return false;
  }

  /**
   * return the next public key derivated from the baseNode.
   * increment the private member index +1.
   */
  private derivePublicKeyWithIndex(isChange: boolean, index: number): Buffer {
    const changeIndex = isChange ? 1 : 0;
    const baseNode = this.masterPublicKeyNode.derive(changeIndex);
    const child: BIP32Interface = baseNode.derive(index);
    return child.publicKey;
  }

  /**
   * Derives the script given as parameter to a keypair (SLIP77).
   * @param scriptPubKey script to derive.
   */
  protected getBlindingKeyPair(
    scriptPubKey: string,
    checkScript = false
  ): { publicKey: Buffer; privateKey: Buffer } {
    if (checkScript) {
      const addressInterface = this.scriptToAddressCache[scriptPubKey];
      if (!addressInterface) {
        throw new Error(`unknow blinding key for script ${scriptPubKey}`);
      }
    }

    const { publicKey, privateKey } = this.masterBlindingKeyNode.derive(
      scriptPubKey
    );
    return { publicKey: publicKey!, privateKey: privateKey! };
  }

  private scriptFromPublicKey(publicKey: Buffer): string {
    return payments
      .p2wpkh({
        pubkey: publicKey,
        network: this.network,
      })
      .output!.toString('hex');
  }

  private createConfidentialAddress(
    signingPublicKey: Buffer,
    blindingPublicKey: Buffer
  ): string {
    return payments.p2wpkh({
      pubkey: signingPublicKey,
      blindkey: blindingPublicKey,
      network: this.network,
    }).confidentialAddress!;
  }

  // store the generation inside local cache
  persistAddressToCache(address: AddressInterfaceExtended): void {
    const publicKeyBuffer = Buffer.from(address.publicKey, 'hex');
    const script = this.scriptFromPublicKey(publicKeyBuffer);

    this.scriptToAddressCache[script] = address;
  }

  getAddress(isChange: boolean, index: number): AddressInterfaceExtended {
    // get the next key pair
    const publicKey = this.derivePublicKeyWithIndex(isChange, index);
    // use the public key to compute the scriptPubKey
    const script = this.scriptFromPublicKey(publicKey);
    // generate the blindKeyPair from the scriptPubKey
    const blindingKeyPair = this.getBlindingKeyPair(script);
    // with blindingPublicKey & signingPublicKey, generate the confidential address
    const confidentialAddress = this.createConfidentialAddress(
      publicKey,
      blindingKeyPair.publicKey
    );
    // create the address generation object
    const path = `${this.baseDerivationPath}/${isChange ? 1 : 0}/${index}`;
    const newAddressGeneration: AddressInterfaceExtended = {
      address: {
        confidentialAddress: confidentialAddress!,
        blindingPrivateKey: blindingKeyPair.privateKey!.toString('hex'),
        derivationPath: path,
        publicKey: publicKey.toString('hex'),
      },
      publicKey: publicKey.toString('hex'),
    };
    // return the generation data
    return newAddressGeneration;
  }

  async getNextAddress(): Promise<AddressInterface> {
    const addr = this.getAddress(false, this.index);
    this.persistAddressToCache(addr);
    this.index = this.index + 1;
    return addr.address;
  }

  async getNextChangeAddress(): Promise<AddressInterface> {
    const addr = this.getAddress(true, this.changeIndex);
    this.persistAddressToCache(addr);
    this.changeIndex = this.changeIndex + 1;
    return addr.address;
  }

  async getBlindingPrivateKey(script: string): Promise<string> {
    return this.getBlindingKeyPair(script).privateKey.toString('hex');
  }

  signPset(_: string): Promise<string> {
    throw new Error(
      'MasterPublicKey is a watch only identity. Use Mnemonic to sign transactions'
    );
  }

  // returns all the addresses generated
  async getAddresses(): Promise<AddressInterface[]> {
    return Object.values(this.scriptToAddressCache).map(
      addrExtended => addrExtended.address
    );
  }

  getXPub(): string {
    return this.masterPublicKeyNode.toBase58();
  }
}
