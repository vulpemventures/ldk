import BIP32Factory, { BIP32Interface } from 'bip32';
import * as bip39 from 'bip39';
import {
  Psbt,
  networks,
  Pset,
  BIP174SigningData,
  script,
} from 'liquidjs-lib';
import { Network } from 'liquidjs-lib/src/networks';
import { BlindingDataLike } from 'liquidjs-lib/src/psbt';
import { SLIP77Factory, Slip77Interface } from 'slip77';

import { IdentityType } from '../types';
import { checkIdentityType, checkMnemonic, toXpub } from '../utils';

import { IdentityInterface, IdentityOpts } from './identity';
import { MasterPublicKey } from './masterpubkey';
import ECPairFactory from 'ecpair';
import { Signer } from 'liquidjs-lib/src/psetv2';

export interface MnemonicOpts {
  mnemonic: string;
  passphrase?: string;
  language?: string;
  baseDerivationPath?: string;
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
export class Mnemonic extends MasterPublicKey implements IdentityInterface {
  readonly mnemonic: string;
  readonly masterPrivateKeyNode: BIP32Interface;
  readonly masterBlindingKeyNode: Slip77Interface;

  public masterPublicKey: string;
  public masterBlindingKey: string;

  constructor(args: IdentityOpts<MnemonicOpts>) {
    checkIdentityType(args.type, IdentityType.Mnemonic);
    // check set the language if it is different of the default language.
    // the "language exists check" is delegated to `bip39.setDefaultWordlist` function.
    bip39.setDefaultWordlist(args.opts.language || 'english');
    checkMnemonic(args.opts.mnemonic);

    // retreive the wallet's seed from mnemonic
    const walletSeed = bip39.mnemonicToSeedSync(
      args.opts.mnemonic,
      args.opts.passphrase
    );
    // generate the master private key from the wallet seed
    const network = (networks as Record<string, Network>)[args.chain];
    const bip32 = BIP32Factory(args.ecclib);
    const masterPrivateKeyNode = bip32.fromSeed(walletSeed, network);

    // compute and expose the masterPublicKey in this.masterPublicKey
    const masterPublicKey = toXpub(
      masterPrivateKeyNode
        .derivePath(
          args.opts.baseDerivationPath || MasterPublicKey.INITIAL_BASE_PATH
        )
        .neutered()
        .toBase58()
    );

    // generate the master blinding key from the seed
    const masterBlindingKeyNode = SLIP77Factory(args.ecclib).fromSeed(
      walletSeed
    );
    const masterBlindingKey = masterBlindingKeyNode.masterKey.toString('hex');

    super({
      ...args,
      type: IdentityType.MasterPublicKey,
      opts: {
        masterPublicKey,
        masterBlindingKey,
        baseDerivationPath: args.opts.baseDerivationPath,
      },
    });

    this.masterBlindingKey = masterBlindingKey;
    this.masterBlindingKeyNode = masterBlindingKeyNode;
    this.masterPublicKey = masterPublicKey;
    this.masterPrivateKeyNode = masterPrivateKeyNode;
    this.mnemonic = args.opts.mnemonic;
  }

  async blindPset(
    psetBase64: string,
    outputsToBlind: number[],
    outputsPubKeys?: Map<number, string>,
    inputsBlindingDataLike?: Map<number, BlindingDataLike>
  ): Promise<string> {
    return super.blindPsetWithBlindKeysGetter(
      (script: Buffer) =>
        super.getBlindingKeyPair(script.toString('hex'), true),
      psetBase64,
      outputsToBlind,
      outputsPubKeys,
      inputsBlindingDataLike
    );
  }

  isAbleToSign(): boolean {
    return true;
  }

  /**
   * return the next keypair derivated from the baseNode.
   * increment the private member index +1.
   */
  private derivePath(
    derivationPath: string
  ): { publicKey: Buffer; privateKey: Buffer } {
    if (!this.ecclib)
      throw new Error('ecclib is missing, cannot derive public key');

    const wif: string = this.masterPrivateKeyNode
      .derivePath(derivationPath)
      .toWIF();
    const { publicKey, privateKey } = ECPairFactory(this.ecclib).fromWIF(
      wif,
      this.network
    );
    return { publicKey: publicKey!, privateKey: privateKey! };
  }

  async signPset(psetBase64: string): Promise<string> {
    if (!this.ecclib) throw new Error('ecclib is missing, cannot sign pset');

    const pset = Psbt.fromBase64(psetBase64);
    const signInputPromises: Promise<void>[] = [];

    for (let index = 0; index < pset.data.inputs.length; index++) {
      const input = pset.data.inputs[index];
      if (input.witnessUtxo) {
        const addressGeneration = this.scriptToAddressCache[
          input.witnessUtxo.script.toString('hex')
        ];

        if (addressGeneration) {
          // if there is an address generated for the input script: build the signing key pair.
          const privateKeyBuffer = this.derivePath(
            addressGeneration.address.derivationPath!
          ).privateKey;
          const signingKeyPair = ECPairFactory(this.ecclib).fromPrivateKey(
            privateKeyBuffer
          );
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

  async signPsetV2(psetBase64: string): Promise<string> {
    if (!this.ecclib) throw new Error('ecclib is missing, cannot sign pset');

    const pset = Pset.fromBase64(psetBase64);
    const signer = new Signer(pset);

    let i = 0;
    for (const input of pset.inputs) {
      const sighashType = input.sighashType;
      if (sighashType === undefined) {
        throw new Error(`Missing sighash type for input ${i}`);
      }
      const prevout = input.getUtxo();
      if (!prevout) {
        throw new Error(`Missing prevout for input ${i}`);
      }

      const addressGeneration = this.scriptToAddressCache[
        prevout.script.toString('hex')
      ];

      if (addressGeneration) {
        const privateKeyBuffer = this.derivePath(
          addressGeneration.address.derivationPath!
        ).privateKey;
        const signingKeyPair = ECPairFactory(this.ecclib).fromPrivateKey(
          privateKeyBuffer
        );
        const preimage = pset.getInputPreimage(i, sighashType);
        const sig: BIP174SigningData = {
          partialSig: {
            pubkey: signingKeyPair.publicKey,
            signature: script.signature.encode(
              signingKeyPair.sign(preimage),
              sighashType
            ),
          },
        };
        signer.addSignature(i, sig, Pset.ECDSASigValidator(this.ecclib));
      }
      i++;
    }

    return pset.toBase64();
  }

  static Random(
    chain: IdentityOpts<any>['chain'],
    ecclib: IdentityOpts<any>['ecclib'],
    baseDerivationPath?: string
  ): Mnemonic {
    const randomMnemonic = bip39.generateMnemonic();
    return new Mnemonic({
      chain,
      ecclib,
      type: IdentityType.Mnemonic,
      opts: {
        mnemonic: randomMnemonic,
        baseDerivationPath,
      },
    });
  }
}
