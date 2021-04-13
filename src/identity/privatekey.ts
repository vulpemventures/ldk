import { BlindingDataLike } from 'liquidjs-lib/types/psbt';
import { ECPair, ECPairInterface, Psbt, payments } from 'liquidjs-lib';
import Identity, {
  IdentityInterface,
  IdentityOpts,
  IdentityType,
} from './identity';
import { AddressInterface } from '../types';

/**
 * This interface describes the shape of the value arguments used in contructor.
 * @member signingKeyWIF a valid private key WIF encoded.
 * @member blindingKeyWIF a valid private key WIF encoded.
 */
export interface PrivateKeyOptsValue {
  signingKeyWIF: string;
  blindingKeyWIF: string;
}

/**
 * A type guard function for PrivateKeyOptsValue
 * @see PrivateKeyOptsValue
 */
function instanceOfPrivateKeyOptsValue(
  value: any
): value is PrivateKeyOptsValue {
  return 'signingKeyWIF' in value && 'blindingKeyWIF' in value;
}

/**
 * The PrivateKey Identity takes a WIF and modelize a user using his private key.
 * @member signingKeyPair private, the key pair used to sign inputs.
 * @member blindingKeyPair private, the key pair used to blind outputs.
 * @member confidentialAddress private, the confidential address generated from keypairs.
 * @member blindingPrivateKey private, the blinding private key associated with the confidential address.
 * @member scriptPubKey private, the scriptPubKey associated to the confidential address.
 * @method signPset sign all the inputs when it's possible (scriptPubKey = input's script).
 * @method getAddresses return an array of one element containing the blindingPrivateKey & the confidentialAddress.
 */
export class PrivateKey extends Identity implements IdentityInterface {
  private signingKeyPair: ECPairInterface;
  private blindingKeyPair: ECPairInterface;

  private confidentialAddress: string;
  private blindingPrivateKey: string;
  private scriptPubKey: Buffer;

  // for privateKey, is restored always return true (there is only one address to generate)
  readonly isRestored: Promise<boolean> = new Promise(() => true);

  constructor(args: IdentityOpts) {
    super(args);

    // checks the args type.
    if (args.type !== IdentityType.PrivateKey) {
      throw new Error('The identity arguments have not the PrivateKey type.');
    }

    // checks if args.value is an instance of PrivateKeyOptsValue interface.
    if (!instanceOfPrivateKeyOptsValue(args.value)) {
      throw new Error(
        'The value of IdentityOpts is not valid for PrivateKey Identity.'
      );
    }

    // decode signing key pair from WIF
    this.signingKeyPair = this.decodeFromWif(args.value.signingKeyWIF);

    // decode blinding key pair from WIF
    this.blindingKeyPair = this.decodeFromWif(args.value.blindingKeyWIF);

    // create payment
    const p2wpkh = payments.p2wpkh({
      pubkey: this.signingKeyPair.publicKey,
      blindkey: this.blindingKeyPair.publicKey,
      network: this.network,
    });

    // store data inside private fields.
    this.confidentialAddress = p2wpkh.confidentialAddress!;
    this.blindingPrivateKey = this.blindingKeyPair.privateKey!.toString('hex');
    this.scriptPubKey = p2wpkh.output!;
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

  private getBlindingKeyPair(
    script: Buffer
  ): { publicKey: Buffer; privateKey: Buffer } {
    if (!script.equals(this.scriptPubKey)) {
      throw new Error(script + ' is unknown by the PrivateKey Identity');
    }

    return {
      publicKey: this.blindingKeyPair.publicKey,
      privateKey: this.blindingKeyPair.privateKey!,
    };
  }

  isAbleToSign(): boolean {
    return true;
  }

  private decodeFromWif(wif: string): ECPairInterface {
    return ECPair.fromWIF(wif, this.network);
  }

  private getAddress(): AddressInterface {
    return {
      confidentialAddress: this.confidentialAddress,
      blindingPrivateKey: this.blindingPrivateKey,
      derivationPath: undefined,
    };
  }

  async getNextAddress(): Promise<AddressInterface> {
    return this.getAddress();
  }

  async getNextChangeAddress(): Promise<AddressInterface> {
    return this.getAddress();
  }

  async getBlindingPrivateKey(script: string): Promise<string> {
    const scriptPubKeyBuffer = Buffer.from(script, 'hex');
    if (!scriptPubKeyBuffer.equals(this.scriptPubKey)) {
      throw new Error('The script is not PrivateKey.scriptPubKey.');
    }

    return this.blindingPrivateKey;
  }

  /**
   * iterate through inputs and sign when it's possible, then returns the signed pset (base64 encoded).
   * @param psetBase64 the base64 encoded pset.
   */
  async signPset(psetBase64: string): Promise<string> {
    const pset = Psbt.fromBase64(psetBase64);
    const indexOfInputs: number[] = [];

    for (let index = 0; index < pset.data.inputs.length; index++) {
      const input = pset.data.inputs[index];
      if (input.witnessUtxo) {
        if (input.witnessUtxo.script.equals(this.scriptPubKey)) {
          indexOfInputs.push(index);
        }
      } else {
        indexOfInputs.push(index);
      }
    }

    // sign all the inputs asynchronously
    await Promise.all(
      indexOfInputs.map((index: number) =>
        pset.signInputAsync(index, this.signingKeyPair)
      )
    );

    return pset.toBase64();
  }

  /**
   * for private key: only returns one confidential address & the associated blindingPrivKey.
   */
  async getAddresses(): Promise<AddressInterface[]> {
    return [
      {
        confidentialAddress: this.confidentialAddress,
        blindingPrivateKey: this.blindingPrivateKey,
        derivationPath: undefined,
      },
    ];
  }
}
