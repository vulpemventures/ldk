import { BlindingDataLike } from 'liquidjs-lib/types/psbt';
import { BIP32Interface, fromBase58 } from 'bip32';
import {
  BufferMap,
  isValidExtendedBlindKey,
  isValidXpub,
  toXpub,
} from '../utils';
import Identity, {
  IdentityInterface,
  IdentityOpts,
  IdentityType,
} from './identity';
import { Slip77Interface, fromMasterBlindingKey } from 'slip77';
import { AddressInterface } from '../types';
import { payments } from 'liquidjs-lib';

export interface MasterPublicKeyOptsValue {
  masterPublicKey: string;
  masterBlindingKey: string;
}

function instanceOfMasterPublicKeyOptsValue(
  value: any
): value is MasterPublicKeyOptsValue {
  return 'masterPublicKey' in value && 'masterBlindingKey' in value;
}

interface AddressInterfaceExtended {
  address: AddressInterface;
  publicKey: string;
}

export class MasterPublicKey extends Identity implements IdentityInterface {
  protected static INITIAL_BASE_PATH: string = "m/84'/0'/0'";
  static INITIAL_INDEX: number = 0;

  private index: number = MasterPublicKey.INITIAL_INDEX;
  private changeIndex: number = MasterPublicKey.INITIAL_INDEX;
  protected scriptToAddressCache: BufferMap<
    AddressInterfaceExtended
  > = new BufferMap();
  private baseDerivationPath: string = MasterPublicKey.INITIAL_BASE_PATH;

  readonly masterPublicKeyNode: BIP32Interface;
  readonly masterBlindingKeyNode: Slip77Interface;

  constructor(args: IdentityOpts) {
    super(args);

    const xpub = toXpub(args.value.masterPublicKey);

    // check the identity type
    if (args.type !== IdentityType.MasterPublicKey) {
      throw new Error(
        'The identity arguments have not the MasterPublicKey type.'
      );
    }
    // check the arguments
    if (!instanceOfMasterPublicKeyOptsValue(args.value)) {
      throw new Error(
        'The value of IdentityOpts is not valid for MasterPublicKey Identity.'
      );
    }
    // validate xpub
    if (!isValidXpub(xpub)) {
      throw new Error('Master public key is not valid');
    }
    // validate master blinding key
    if (!isValidExtendedBlindKey(args.value.masterBlindingKey)) {
      throw new Error('Master blinding key is not valid');
    }

    this.masterPublicKeyNode = fromBase58(xpub);
    this.masterBlindingKeyNode = fromMasterBlindingKey(
      args.value.masterBlindingKey
    );
  }

  async blindPset(
    psetBase64: string,
    outputsToBlind: number[],
    outputsPubKeys?: Map<number, string>,
    inputsBlindingDataLike?: Map<number, BlindingDataLike>
  ): Promise<string> {
    return super.blindPsetWithBlindKeysGetter(
      (script: Buffer) => this.getBlindingKeyPair(script, true),
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
    scriptPubKey: Buffer,
    checkScript: boolean = false
  ): { publicKey: Buffer; privateKey: Buffer } {
    if (checkScript) {
      const addressInterface = this.scriptToAddressCache.get(scriptPubKey);
      if (!addressInterface) {
        throw new Error(
          `unknow blinding key for script ${scriptPubKey.toString('hex')}`
        );
      }
    }

    const { publicKey, privateKey } = this.masterBlindingKeyNode.derive(
      scriptPubKey
    );
    return { publicKey: publicKey!, privateKey: privateKey! };
  }

  private scriptFromPublicKey(publicKey: Buffer): Buffer {
    return payments.p2wpkh({
      pubkey: publicKey,
      network: this.network,
    }).output!;
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
  persistAddressToCache(
    address: AddressInterfaceExtended,
    isChange: boolean
  ): void {
    const publicKeyBuffer = Buffer.from(address.publicKey, 'hex');
    const script = this.scriptFromPublicKey(publicKeyBuffer);
    this.scriptToAddressCache.set(script, address);

    if (isChange) this.changeIndex += 1;
    else this.index += 1;
  }

  getAddress(isChange: boolean, index: number): AddressInterfaceExtended {
    // get the next key pair
    const publicKey = this.derivePublicKeyWithIndex(isChange, index);
    // use the public key to compute the scriptPubKey
    const script: Buffer = this.scriptFromPublicKey(publicKey);
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
      },
      publicKey: publicKey.toString('hex'),
    };
    // return the generation data
    return newAddressGeneration;
  }

  async getNextAddress(): Promise<AddressInterface> {
    const addr = this.getAddress(false, this.index);
    this.persistAddressToCache(addr, false);
    return addr.address;
  }

  async getNextChangeAddress(): Promise<AddressInterface> {
    const addr = this.getAddress(true, this.changeIndex);
    this.persistAddressToCache(addr, true);
    return addr.address;
  }

  async getBlindingPrivateKey(script: string): Promise<string> {
    const scriptPubKeyBuffer = Buffer.from(script, 'hex');
    return this.getBlindingKeyPair(scriptPubKeyBuffer).privateKey.toString(
      'hex'
    );
  }

  signPset(_: string): Promise<string> {
    throw new Error(
      'MasterPublicKey is a watch only identity. Use Mnemonic to sign transactions'
    );
  }

  // returns all the addresses generated
  async getAddresses(): Promise<AddressInterface[]> {
    return this.scriptToAddressCache
      .values()
      .map(addrExtended => addrExtended.address);
  }
}
