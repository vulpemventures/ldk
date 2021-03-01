import { BlindingDataLike } from 'liquidjs-lib/types/psbt';
import * as bip39 from 'bip39';
import { BIP32Interface, fromSeed as bip32fromSeed } from 'bip32';
import { BufferMap, fromXpub } from '../utils';
import { ECPair, Psbt, bip32, payments } from 'liquidjs-lib';
import Identity, {
  IdentityInterface,
  IdentityOpts,
  IdentityType,
} from './identity';
import { Slip77Interface, fromSeed as slip77fromSeed } from 'slip77';
import { AddressInterface } from '../types';

export interface MnemonicOptsValue {
  mnemonic: string;
  language?: string;
}

function instanceOfMnemonicOptsValue(value: any): value is MnemonicOptsValue {
  return 'mnemonic' in value;
}

interface AddressInterfaceExtended {
  address: AddressInterface;
  signingPrivateKey: string;
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

/**
 * @class Mnemonic
 * Get a mnemonic as parameter to set up an HD Wallet.
 * @member masterPrivateKeyNode a BIP32 node computed from the seed, used to generate signing key pairs.
 * @member masterBlindingKeyNode a SLIP77 node computed from the seed, used to generate the blinding key pairs.
 * @member derivationPath the base derivation path.
 * @member index the next index used to derive the base node (for signing key pairs).
 * @member scriptToAddressCache a map scriptPubKey --> address generation.
 */
export class Mnemonic extends Identity implements IdentityInterface {
  static INITIAL_BASE_PATH: string = "m/84'/0'/0'";
  static INITIAL_INDEX: number = 0;

  private baseDerivationPath: string = Mnemonic.INITIAL_BASE_PATH;
  private index: number = Mnemonic.INITIAL_INDEX;
  private changeIndex: number = Mnemonic.INITIAL_INDEX;
  private scriptToAddressCache: BufferMap<
    AddressInterfaceExtended
  > = new BufferMap();

  readonly masterPrivateKeyNode: BIP32Interface;
  readonly masterBlindingKeyNode: Slip77Interface;

  public masterPublicKey: string;
  public masterBlindingKey: string;

  readonly isRestored: Promise<boolean>;

  constructor(args: IdentityOpts) {
    super(args);

    // check the identity type
    if (args.type !== IdentityType.Mnemonic) {
      throw new Error('The identity arguments have not the Mnemonic type.');
    }
    // check the arguments
    if (!instanceOfMnemonicOptsValue(args.value)) {
      throw new Error(
        'The value of IdentityOpts is not valid for Mnemonic Identity.'
      );
    }
    // check set the language if it is different of the default language.
    // the "language exists check" is delegated to `bip39.setDefaultWordlist` function.
    if (args.value.language) {
      bip39.setDefaultWordlist(args.value.language);
    } else {
      bip39.setDefaultWordlist('english');
    }

    // validate the mnemonic
    if (!bip39.validateMnemonic(args.value.mnemonic)) {
      throw new Error('Mnemonic is not valid.');
    }

    // retreive the wallet's seed from mnemonic
    const walletSeed = bip39.mnemonicToSeedSync(args.value.mnemonic);
    // generate the master private key from the wallet seed
    this.masterPrivateKeyNode = bip32fromSeed(walletSeed, this.network);

    // compute and expose the masterPublicKey in this.masterPublicKey
    const baseNode = this.masterPrivateKeyNode.derivePath(
      this.baseDerivationPath
    );
    const pubkey = baseNode.publicKey;
    const accountPublicKey = bip32
      .fromPublicKey(pubkey, baseNode.chainCode, baseNode.network)
      .toBase58();

    this.masterPublicKey = fromXpub(accountPublicKey, args.chain);

    // generate the master blinding key from the seed
    this.masterBlindingKeyNode = slip77fromSeed(walletSeed);
    this.masterBlindingKey = this.masterBlindingKeyNode.masterKey.toString(
      'hex'
    );

    this.isRestored = new Promise(() => true);
    if (args.initializeFromRestorer) {
      // restore from restorer
      this.isRestored = this.restore().catch((reason: any) => {
        throw new Error(`Error during restoration step: ${reason}`);
      });
    }
  }

  async blindPset(
    psetBase64: string,
    outputsToBlind: number[],
    outputsPubKeys?: Map<number, string>,
    inputsBlindingDataLike?: Map<number, BlindingDataLike>
  ): Promise<string> {
    return super.blindPsetWithBlindKeysGetter(
      (script: Buffer) => this.getBlindingKeyPair(script),
      psetBase64,
      outputsToBlind,
      outputsPubKeys,
      inputsBlindingDataLike
    );
  }

  isAbleToSign(): boolean {
    return true;
  }

  private getCurrentDerivationPath(isChange: boolean): string {
    const changeValue: number = isChange ? 1 : 0;
    return `${this.baseDerivationPath}/${changeValue}`;
  }

  /**
   * return the next keypair derivated from the baseNode.
   * increment the private member index +1.
   */
  private deriveKeyWithIndex(
    isChange: boolean,
    index: number
  ): { publicKey: Buffer; privateKey: Buffer } {
    const baseNode = this.masterPrivateKeyNode.derivePath(
      this.getCurrentDerivationPath(isChange)
    );
    const wif: string = baseNode.derive(index).toWIF();
    const { publicKey, privateKey } = ECPair.fromWIF(wif, this.network);
    return { publicKey: publicKey!, privateKey: privateKey! };
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
    const privateKeyBuffer = Buffer.from(address.signingPrivateKey, 'hex');
    const publicKey: Buffer = ECPair.fromPrivateKey(privateKeyBuffer, {
      network: this.network,
    }).publicKey!;
    const script = this.scriptFromPublicKey(publicKey);
    this.scriptToAddressCache.set(script, address);
  }

  private getAddress(
    isChange: boolean,
    index: number
  ): AddressInterfaceExtended {
    // get the next key pair
    const signingKeyPair = this.deriveKeyWithIndex(isChange, index);
    // use the public key to compute the scriptPubKey
    const script: Buffer = this.scriptFromPublicKey(signingKeyPair.publicKey);
    // generate the blindKeyPair from the scriptPubKey
    const blindingKeyPair = this.getBlindingKeyPair(script);
    // with blindingPublicKey & signingPublicKey, generate the confidential address
    const confidentialAddress = this.createConfidentialAddress(
      signingKeyPair.publicKey,
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
      derivationPath: path,
      signingPrivateKey: signingKeyPair.privateKey!.toString('hex'),
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

  async signPset(psetBase64: string): Promise<string> {
    const pset = Psbt.fromBase64(psetBase64);
    const signInputPromises: Array<Promise<void>> = [];

    for (let index = 0; index < pset.data.inputs.length; index++) {
      const input = pset.data.inputs[index];
      if (input.witnessUtxo) {
        const addressGeneration = this.scriptToAddressCache.get(
          input.witnessUtxo.script
        );

        if (addressGeneration) {
          // if there is an address generated for the input script: build the signing key pair.
          const privateKeyBuffer = Buffer.from(
            addressGeneration.signingPrivateKey,
            'hex'
          );
          const signingKeyPair = ECPair.fromPrivateKey(privateKeyBuffer);
          // add the promise to array
          signInputPromises.push(pset.signInputAsync(index, signingKeyPair));
        }
      }
    }
    // wait that all signing promise resolved
    await Promise.all(signInputPromises);
    // return the signed pset, base64 encoded.
    return pset.toBase64();
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
   * @param change is change?
   */
  private async generateSetOfAddresses(
    fromIndex: number,
    numberToGenerate: number,
    change: boolean
  ): Promise<AddressInterfaceExtended[]> {
    // asynchronous getAddress function
    const getAddressAsync = async (
      index: number
    ): Promise<AddressInterfaceExtended> => {
      return this.getAddress(change, index);
    };

    // index of addresses to generate.
    const indexToGenerate = Array.from(
      { length: numberToGenerate },
      (_, i) => i + fromIndex
    );

    // return a promise when all addresses are generated.
    return Promise.all(indexToGenerate.map(getAddressAsync));
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
    let restoredAddresses: AddressInterfaceExtended[] = [];

    for (let i = 0; i < 2; i++) {
      const change = i === 1;
      let counter = 0;
      let index = 0;

      const usedAddresses: AddressInterfaceExtended[] = [];
      const incrementOrResetCounter = (
        addresses: AddressInterfaceExtended[]
      ) => (hasBeenUsed: boolean, index: number) => {
        counter++;
        if (hasBeenUsed) {
          counter = 0;
          usedAddresses.push(addresses[index]);
        }
      };

      while (counter < NOT_USED_ADDRESSES_LIMIT) {
        // generate addresses to test
        const addressesToTest = await this.generateSetOfAddresses(
          index,
          NOT_USED_ADDRESSES_LIMIT - counter,
          change
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
      const allIndex = usedAddresses.map(getIndex);
      if (!change) {
        this.index =
          allIndex.length > 0
            ? Math.max(...allIndex) + 1
            : Mnemonic.INITIAL_INDEX;
      } else {
        this.changeIndex =
          allIndex.length > 0
            ? Math.max(...allIndex) + 1
            : Mnemonic.INITIAL_INDEX;
      }
      restoredAddresses = restoredAddresses.concat(usedAddresses);
    }

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
