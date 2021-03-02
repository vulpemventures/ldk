import { MasterPublicKey } from './masterpubkey';
import { BlindingDataLike } from 'liquidjs-lib/types/psbt';
import * as bip39 from 'bip39';
import { BIP32Interface, fromSeed as bip32fromSeed } from 'bip32';
import { fromXpub } from '../utils';
import { ECPair, Psbt, bip32, networks, Network } from 'liquidjs-lib';
import { IdentityInterface, IdentityOpts, IdentityType } from './identity';
import { Slip77Interface, fromSeed as slip77fromSeed } from 'slip77';
import { AddressInterface } from '../types';

export interface MnemonicOptsValue {
  mnemonic: string;
  language?: string;
}

function instanceOfMnemonicOptsValue(value: any): value is MnemonicOptsValue {
  return 'mnemonic' in value;
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
  readonly masterPrivateKeyNode: BIP32Interface;
  readonly masterBlindingKeyNode: Slip77Interface;

  public masterPublicKey: string;
  public masterBlindingKey: string;

  constructor(args: IdentityOpts) {
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
    const network = (networks as Record<string, Network>)[args.chain];
    const masterPrivateKeyNode = bip32fromSeed(walletSeed, network);

    // compute and expose the masterPublicKey in this.masterPublicKey
    const baseNode = masterPrivateKeyNode.derivePath(
      MasterPublicKey.INITIAL_BASE_PATH
    );

    const pubkey = baseNode.publicKey;
    const accountPublicKey = bip32
      .fromPublicKey(pubkey, baseNode.chainCode, baseNode.network)
      .toBase58();

    const masterPublicKey = fromXpub(accountPublicKey, args.chain);

    // generate the master blinding key from the seed
    const masterBlindingKeyNode = slip77fromSeed(walletSeed);
    const masterBlindingKey = masterBlindingKeyNode.masterKey.toString('hex');

    super({
      ...args,
      type: IdentityType.MasterPublicKey,
      value: {
        masterPublicKey,
        masterBlindingKey,
      },
    });

    this.masterBlindingKey = masterBlindingKey;
    this.masterBlindingKeyNode = masterBlindingKeyNode;
    this.masterPublicKey = masterPublicKey;
    this.masterPrivateKeyNode = masterPrivateKeyNode;
  }

  async blindPset(
    psetBase64: string,
    outputsToBlind: number[],
    outputsPubKeys?: Map<number, string>,
    inputsBlindingDataLike?: Map<number, BlindingDataLike>
  ): Promise<string> {
    return super.blindPsetWithBlindKeysGetter(
      (script: Buffer) => super.getBlindingKeyPair(script),
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
    const wif: string = this.masterPrivateKeyNode
      .derivePath(derivationPath)
      .toWIF();
    const { publicKey, privateKey } = ECPair.fromWIF(wif, this.network);
    return { publicKey: publicKey!, privateKey: privateKey! };
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
          const privateKeyBuffer = this.derivePath(
            addressGeneration.address.derivationPath!
          ).privateKey;
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
    return super.getAddresses();
  }
}
