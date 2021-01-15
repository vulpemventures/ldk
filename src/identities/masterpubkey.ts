import { AddressInterface } from '../types';
import Identity, {
  IdentityInterface,
  IdentityType,
  IdentityOpts,
} from '../identity';
import {
  BufferMap,
  isValidXpub,
  isValidExtendedBlindKey,
  toXpub,
} from '../utils';
import { BIP32Interface, fromBase58 } from 'bip32';
import { Slip77Interface, fromMasterBlindingKey } from 'slip77';
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
  derivationPath: string;
}

// util function that parse a derivation path and return the index
function getIndex(addrExtended: AddressInterfaceExtended) {
  const derivationPathSplitted = addrExtended.derivationPath.split('/');
  const index: number = parseInt(
    derivationPathSplitted[derivationPathSplitted.length - 1]
  );

  return index;
}

export class MasterPublicKey extends Identity implements IdentityInterface {
  static INITIAL_INDEX: number = 0;

  private index: number = MasterPublicKey.INITIAL_INDEX;
  private changeIndex: number = MasterPublicKey.INITIAL_INDEX;
  private scriptToAddressCache: BufferMap<
    AddressInterfaceExtended
  > = new BufferMap();

  readonly masterPublicKeyNode: BIP32Interface;
  readonly masterBlindingKeyNode: Slip77Interface;

  readonly isRestored: Promise<boolean>;

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

    this.isRestored = new Promise(() => true);
    if (args.initializeFromRestorer) {
      // restore from restorer
      this.isRestored = this.restore().catch((reason: any) => {
        throw new Error(`Error during restoration step: ${reason}`);
      });
    }
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
  private getBlindingKeyPair(
    scriptPubKey: Buffer
  ): { publicKey: Buffer; privateKey: Buffer } {
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
  private persistAddressToCache(address: AddressInterfaceExtended): void {
    const publicKeyBuffer = Buffer.from(address.publicKey, 'hex');
    const script = this.scriptFromPublicKey(publicKeyBuffer);
    this.scriptToAddressCache.set(script, address);
  }

  private getAddress(
    isChange: boolean,
    index: number
  ): AddressInterfaceExtended {
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
    const newAddressGeneration: AddressInterfaceExtended = {
      address: {
        confidentialAddress: confidentialAddress!,
        blindingPrivateKey: blindingKeyPair.privateKey!.toString('hex'),
      },
      derivationPath: `${isChange ? 1 : 0}/${index}`,
      publicKey: publicKey.toString('hex'),
    };
    // return the generation data
    return newAddressGeneration;
  }

  getNextAddress(): AddressInterface {
    const addr = this.getAddress(false, this.index);
    this.persistAddressToCache(addr);
    this.index += 1;
    return addr.address;
  }

  getNextChangeAddress(): AddressInterface {
    const addr = this.getAddress(true, this.changeIndex);
    this.persistAddressToCache(addr);
    this.changeIndex += 1;
    return addr.address;
  }

  getBlindingPrivateKey(script: string): string {
    const scriptPubKeyBuffer = Buffer.from(script, 'hex');
    return this.getBlindingKeyPair(scriptPubKeyBuffer).privateKey.toString(
      'hex'
    );
  }

  signPset(_: string): string {
    throw new Error(
      'MasterPublicKey is a watch only identity. Use Mnemonic to sign transactions'
    );
  }

  // returns all the addresses generated
  getAddresses(): AddressInterface[] {
    return this.scriptToAddressCache
      .values()
      .map(addrExtended => addrExtended.address);
  }

  // RESTORATION PART

  /**
   * generate a range of addresses asynchronously.
   * @param fromIndex generation will begin at index `fromIndex`
   * @param numberToGenerate number of addresses to generate.
   */
  private async generateSetOfAddresses(
    fromIndex: number,
    numberToGenerate: number
  ): Promise<AddressInterfaceExtended[]> {
    // asynchronous getAddress function
    const getAddressAsync = async (
      index: number
    ): Promise<AddressInterfaceExtended> => {
      return this.getAddress(false, index);
    };

    // index of addresses to generate.
    const indexToGenerate = Array.from(
      { length: numberToGenerate },
      (_, i) => i + fromIndex
    );

    // return a promise when all addresses are generated.
    return Promise.all(indexToGenerate.map(getAddressAsync));
  }

  private async addressToChangeAddressAsync(
    address: AddressInterfaceExtended
  ): Promise<AddressInterfaceExtended> {
    const index = getIndex(address);
    return this.getAddress(true, index);
  }

  private async checkAddressesWithRestorer(
    addresses: AddressInterfaceExtended[]
  ): Promise<boolean[]> {
    const confidentialAddresses: string[] = addresses.map(
      addrI => addrI.address.confidentialAddress
    );

    const results: boolean[] = await this.restorer.addressesHaveBeenUsed(
      confidentialAddresses
    );

    return results;
  }

  private async restoreAddresses(): Promise<AddressInterfaceExtended[]> {
    const NOT_USED_ADDRESSES_LIMIT = 20;
    let counter = 0;
    let index = 0;

    const restoredAddresses: AddressInterfaceExtended[] = [];

    const incrementOrResetCounter = (addresses: AddressInterfaceExtended[]) => (
      hasBeenUsed: boolean,
      index: number
    ) => {
      if (hasBeenUsed === true) {
        counter = 0;
        restoredAddresses.push(addresses[index]);
      } else {
        counter += 1;
      }
    };

    while (counter < NOT_USED_ADDRESSES_LIMIT) {
      // generate addresses to test
      const addressesToTest = await this.generateSetOfAddresses(
        index,
        NOT_USED_ADDRESSES_LIMIT - counter
      );
      // test all addresses asynchronously using restorer.
      const hasBeenUsedArray: boolean[] = await this.checkAddressesWithRestorer(
        addressesToTest
      );

      // iterate through array
      // if address has been used before = push to restoredAddresses array
      // else increment counter
      hasBeenUsedArray.forEach(incrementOrResetCounter(addressesToTest));
      index += NOT_USED_ADDRESSES_LIMIT;
    }

    // Set the index
    const allIndex = restoredAddresses.map(getIndex);
    this.index =
      allIndex.length > 0
        ? Math.max(...allIndex) + 1
        : MasterPublicKey.INITIAL_INDEX;

    // check for change address
    const changeAddresses: AddressInterfaceExtended[] = await Promise.all(
      restoredAddresses.map(addr => this.addressToChangeAddressAsync(addr))
    );

    const hasBeenUsedArrayChange: boolean[] = await this.checkAddressesWithRestorer(
      changeAddresses
    );

    const usedChangeAddresses: AddressInterfaceExtended[] = changeAddresses.filter(
      (_: AddressInterfaceExtended, index: number) =>
        hasBeenUsedArrayChange[index]
    );

    // Set the index
    const allChangeIndex = usedChangeAddresses.map(getIndex);
    this.changeIndex =
      allChangeIndex.length > 0
        ? Math.max(...allChangeIndex) + 1
        : MasterPublicKey.INITIAL_INDEX;

    restoredAddresses.push(...usedChangeAddresses);
    // return the restored address
    return restoredAddresses;
  }

  /**
   * Restore try to (1) generate and verify a range of addresses & (2) persist the address to the instance cache.
   * Then it returns true if everything is ok.
   */
  private async restore(): Promise<boolean> {
    const restoredAddresses = await this.restoreAddresses();
    restoredAddresses.forEach(addr => this.persistAddressToCache(addr));
    return true;
  }
}
