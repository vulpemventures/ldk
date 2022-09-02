import BIP32Factory, { BIP32Interface } from 'bip32';
import { mnemonicToSeedSync } from 'bip39';
import ECPairFactory from 'ecpair';
import { address, networks, Psbt, script } from 'liquidjs-lib';
import { Network } from 'liquidjs-lib/src/networks';
import { BIP174SigningData, Signer, Pset } from 'liquidjs-lib/src/psetv2';
import { IdentityType, HDSignerMultisig } from '../types';
import { checkIdentityType, checkMnemonic, toXpub } from '../utils';
import { IdentityInterface, IdentityOpts } from './identity';
import {
  DEFAULT_BASE_DERIVATION_PATH,
  MultisigWatchOnly,
  MultisigWatchOnlyOpts,
} from './multisigWatchOnly';

export type MultisigOpts = {
  signer: HDSignerMultisig;
} & MultisigWatchOnlyOpts;

export class Multisig extends MultisigWatchOnly implements IdentityInterface {
  readonly baseDerivationPath: string;
  readonly baseNode: BIP32Interface;
  readonly scriptToPath: Record<string, string>;

  constructor(args: IdentityOpts<MultisigOpts>) {
    checkIdentityType(args.type, IdentityType.Multisig);
    checkMnemonic(args.opts.signer.mnemonic);

    const walletSeed = mnemonicToSeedSync(
      args.opts.signer.mnemonic,
      args.opts.signer.passphrase
    );
    const network = (networks as Record<string, Network>)[args.chain];
    const masterPrivateKeyNode = BIP32Factory(args.ecclib).fromSeed(
      walletSeed,
      network
    );

    const baseNode = masterPrivateKeyNode.derivePath(
      args.opts.signer.baseDerivationPath || DEFAULT_BASE_DERIVATION_PATH
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
      args.opts.signer.baseDerivationPath || DEFAULT_BASE_DERIVATION_PATH;
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
    const signInputPromises: Promise<void>[] = [];

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
          const signingKeyPair = ECPairFactory(this.ecclib).fromPrivateKey(
            privKey
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
      const derivationPath = this.scriptToPath[prevout.script.toString('hex')];

      if (derivationPath) {
        // if there is an address generated for the input script: build the signing key pair.
        const privKey = this.baseNode.derivePath(derivationPath).privateKey;
        if (!privKey) throw new Error('signing private key is undefined');
        const signingKeyPair = ECPairFactory(this.ecclib).fromPrivateKey(
          privKey
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
      i++
    }

    return pset.toBase64();
  }

  getXPub(): string {
    return toXpub(
      BIP32Factory(this.ecclib)
        .fromPublicKey(
          this.baseNode.publicKey,
          this.baseNode.chainCode,
          this.network
        )
        .toBase58()
    );
  }

  private toScript(addr: string) {
    return address.toOutputScript(addr, this.network).toString('hex');
  }
}
