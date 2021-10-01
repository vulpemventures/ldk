import { BIP32Interface, fromPublicKey, fromSeed } from 'bip32';
import { mnemonicToSeedSync } from 'bip39';
import { address, ECPair, Network, networks, Psbt } from 'liquidjs-lib';
import { SignerMultisig } from '../types';
import { checkIdentityType, checkMnemonic, toXpub } from '../utils';
import { IdentityInterface, IdentityOpts, IdentityType } from './identity';
import { MultisigWatchOnly, MultisigWatchOnlyOpts } from './multisigWatchOnly';

export type MultisigOpts = {
  signer: SignerMultisig;
} & MultisigWatchOnlyOpts;

export class Multisig extends MultisigWatchOnly implements IdentityInterface {
  static DEFAULT_BASE_DERIVATION_PATH = "m/48'/0'/0'/2'"; // --> bip48
  readonly baseDerivationPath: string;
  readonly baseNode: BIP32Interface;
  readonly scriptToPath: Record<string, string>;

  constructor(args: IdentityOpts<MultisigOpts>) {
    checkIdentityType(args.type, IdentityType.Multisig);
    checkMnemonic(args.opts.signer.mnemonic);

    const walletSeed = mnemonicToSeedSync(args.opts.signer.mnemonic);
    const network = (networks as Record<string, Network>)[args.chain];
    const masterPrivateKeyNode = fromSeed(walletSeed, network);

    const baseNode = masterPrivateKeyNode.derivePath(
      args.opts.signer.baseDerivationPath ||
        Multisig.DEFAULT_BASE_DERIVATION_PATH
    );

    super({
      ...args,
      opts: {
        ...args.opts,
        cosigners: args.opts.cosigners.concat([args.opts.signer]),
      },
      type: IdentityType.MultisigWatchOnly,
    });

    this.baseDerivationPath =
      args.opts.signer.baseDerivationPath ||
      Multisig.DEFAULT_BASE_DERIVATION_PATH;
    this.baseNode = baseNode;
    this.scriptToPath = {};
  }

  async getNextAddress() {
    const next = await super.getNextAddress();
    if (!next.derivationPath)
      throw new Error('need derivation path to cache addresses');
    this.scriptToPath[this.toScript(next.confidentialAddress)] =
      next.derivationPath;
    return next;
  }

  async getNextChangeAddress() {
    const next = await super.getNextChangeAddress();
    if (!next.derivationPath)
      throw new Error('need derivation path to cache addresses');
    this.scriptToPath[this.toScript(next.confidentialAddress)] =
      next.derivationPath;
    return next;
  }

  isAbleToSign(): boolean {
    return true;
  }

  async signPset(psetBase64: string): Promise<string> {
    const pset = Psbt.fromBase64(psetBase64);
    const signInputPromises: Array<Promise<void>> = [];

    for (let index = 0; index < pset.data.inputs.length; index++) {
      const input = pset.data.inputs[index];
      if (input.witnessUtxo) {
        const derivationPath = this.scriptToPath[
          input.witnessUtxo.script.toString('hex')
        ];

        if (derivationPath) {
          // if there is an address generated for the input script: build the signing key pair.
          const privKey = this.baseNode.derivePath(derivationPath).privateKey;
          if (!privKey) throw new Error('signing private key is undefined');
          const signingKeyPair = ECPair.fromPrivateKey(privKey);
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

  getXPub(): string {
    return toXpub(
      fromPublicKey(
        this.baseNode.publicKey,
        this.baseNode.chainCode,
        this.network
      ).toBase58()
    );
  }

  private toScript(addr: string) {
    return address.toOutputScript(addr, this.network).toString('hex');
  }
}
