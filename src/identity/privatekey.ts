import ECPairFactory, { ECPairInterface } from 'ecpair';
import { Psbt, payments, script } from 'liquidjs-lib';
import { BlindingDataLike } from 'liquidjs-lib/src/psbt';
import {
  Signer,
  Pset,
  BIP174SigningData,
  OwnedInput,
} from 'liquidjs-lib/src/psetv2';
import { AddressInterface, IdentityType } from '../types';
import { checkIdentityType } from '../utils';
import { Identity, IdentityInterface, IdentityOpts } from './identity';

/**
 * This interface describes the shape of the value arguments used in contructor.
 * @member signingKeyWIF a valid private key WIF encoded.
 * @member blindingKeyWIF a valid private key WIF encoded.
 */
export interface PrivateKeyOpts {
  signingKeyWIF: string;
  blindingKeyWIF: string;
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

  constructor(args: IdentityOpts<PrivateKeyOpts>) {
    super(args);

    // checks the args type.
    checkIdentityType(args.type, IdentityType.PrivateKey);

    // decode signing key pair from WIF
    this.signingKeyPair = this.decodeFromWif(args.opts.signingKeyWIF);

    // decode blinding key pair from WIF
    this.blindingKeyPair = this.decodeFromWif(args.opts.blindingKeyWIF);

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
    return ECPairFactory(this.ecclib).fromWIF(wif, this.network);
  }

  private getAddress(): AddressInterface {
    return {
      confidentialAddress: this.confidentialAddress,
      blindingPrivateKey: this.blindingPrivateKey,
      derivationPath: undefined,
      publicKey: this.signingKeyPair.publicKey.toString('hex'),
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
   * iterate through inputs and sign when it's possible, then returns the signed psetv2 (base64 encoded).
   * @param psetBase64 the base64 encoded pset.
   */
  async signPsetV2(psetBase64: string): Promise<string> {
    const pset = Pset.fromBase64(psetBase64);
    const indexOfInputs: number[] = [];

    pset.inputs.forEach((input, i) => {
      if (input.sighashType === undefined) {
        throw new Error(`Missing sighash type for input ${i}`);
      }
      const prevout = input.getUtxo();
      if (!prevout) {
        throw new Error(`Missing prevout for input ${i}`);
      }
      if (prevout.script.equals(this.scriptPubKey)) {
        indexOfInputs.push(i);
      }
    });

    const signer = new Signer(pset);
    indexOfInputs.forEach(i => {
      const sighashType = pset.inputs[i].sighashType!;
      const preimage = pset.getInputPreimage(i, sighashType);
      const sig: BIP174SigningData = {
        partialSig: {
          pubkey: this.signingKeyPair.publicKey,
          signature: script.signature.encode(
            this.signingKeyPair.sign(preimage),
            sighashType
          ),
        },
      };
      signer.addSignature(i, sig, Pset.ECDSASigValidator(this.ecclib));
    });

    return pset.toBase64();
  }

  async blindPsetV2(
    psetBase64: string,
    lastBlinder: boolean,
    unblindedInputs?: OwnedInput[]
  ): Promise<string> {
    return super.blindPsetV2WithSource(psetBase64, lastBlinder, {
      unblindedInputs,
      blindingKeys: [Buffer.from(this.blindingPrivateKey, 'hex')],
    });
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
        publicKey: this.signingKeyPair.publicKey.toString('hex'),
      },
    ];
  }
}
