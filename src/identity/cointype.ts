import { mnemonicToSeedSync, validateMnemonic, wordlists } from 'bip39';
import { BlindingDataLike } from 'liquidjs-lib';
import { SLIP77Factory } from 'slip77';
import { AddressInterface, IdentityType } from '../types';
import { checkIdentityType } from '../utils';
import { Identity, IdentityInterface, IdentityOpts } from './identity';
import { MasterPublicKey, MasterPublicKeyOpts } from './masterpubkey';
import { Mnemonic, MnemonicOpts } from './mnemonic';

// Params needed by BIP84 address derivation
// defines an hardened coin account derivation path
// use "type" instead of "interface" to be compliant with identityInterface
export type CointypeAccount = {
  cointype: number;
  account: number;
};

export interface MasterKeyWithAccountPath {
  masterPublicKey: MasterPublicKeyOpts['masterPublicKey'];
  derivationPath: string;
}

export interface CointypeWatchOnlyOpts {
  accounts: MasterKeyWithAccountPath[];
  masterBlindingKey: MasterPublicKeyOpts['masterBlindingKey'];
}

export function derivationPathBIP84(cointype: number, account: number) {
  return `m/84'/${cointype}'/${account}'`;
}

export class NoAccountError extends Error {
  constructor(account: number, coinType: number) {
    super(`No account #${account} for coin type ${coinType}`);
  }
}

export type CointypeIdentity<
  T extends MasterPublicKey = MasterPublicKey
> = IdentityInterface & {
  getAccount: (opts: CointypeAccount) => T;
  accounts: T[];
};

export class CointypeWatchOnly extends Identity
  implements CointypeIdentity<MasterPublicKey> {
  readonly accounts: MasterPublicKey[] = [];

  constructor(args: IdentityOpts<CointypeWatchOnlyOpts>) {
    super(args);
    checkIdentityType(args.type, IdentityType.CointypeWatchOnly);
    this.accounts = args.opts.accounts.map(accountAndKey => {
      return new MasterPublicKey({
        ...args,
        type: IdentityType.MasterPublicKey,
        opts: {
          masterPublicKey: accountAndKey.masterPublicKey,
          masterBlindingKey: args.opts.masterBlindingKey,
          baseDerivationPath: accountAndKey.derivationPath,
        },
      });
    });
  }

  getAccount(param: CointypeAccount): MasterPublicKey {
    const masterPublicKey = this.accounts.find(masterPublicKey => {
      return (
        masterPublicKey.baseDerivationPath ===
        derivationPathBIP84(param.cointype, param.account)
      );
    });
    if (!masterPublicKey) {
      throw new NoAccountError(param.account, param.cointype);
    }
    return masterPublicKey;
  }

  private getBlindingKeyPair(
    script: string,
    checkScript = false
  ): { publicKey: Buffer; privateKey: Buffer } {
    for (const m of this.accounts) {
      try {
        return m.getBlindingKeyPair(script, checkScript);
      } catch (e) {
        // ignore
      }
    }
    throw new Error('Blinding key pair not found');
  }

  getNextAddress(params: CointypeAccount): Promise<AddressInterface> {
    return this.getAccount(params).getNextAddress();
  }

  getNextChangeAddress(params: CointypeAccount): Promise<AddressInterface> {
    return this.getAccount(params).getNextChangeAddress();
  }

  async getAddresses(): Promise<AddressInterface[]> {
    const allAddresses = [];
    for (const m of this.accounts) {
      allAddresses.push(...(await m.getAddresses()));
    }
    return allAddresses;
  }

  async getBlindingPrivateKey(script: string): Promise<string> {
    const { privateKey } = this.getBlindingKeyPair(script, true);
    return privateKey.toString('hex');
  }

  isAbleToSign(): boolean {
    return false;
  }

  blindPset(
    psetBase64: string,
    outputsIndexToBlind: number[],
    outputsPubKeysByIndex?: Map<number, string> | undefined,
    inputsBlindingDataLike?: Map<number, BlindingDataLike> | undefined
  ): Promise<string> {
    return super.blindPsetWithBlindKeysGetter(
      (script: Buffer) => this.getBlindingKeyPair(script.toString('hex'), true),
      psetBase64,
      outputsIndexToBlind,
      outputsPubKeysByIndex,
      inputsBlindingDataLike
    );
  }

  signPset(_: string): Promise<string> {
    throw new Error('Identity is not able to sign');
  }
}

export type CointypeMnemonicOpts = Omit<MnemonicOpts, 'baseDerivationPath'>;

/**
 * @class CointypeMnemonic
 * @classdesc CointypeMnemonic is a class that represents a mnemonic identity with multiple accounts for different cointypes, each account is the hardened derivation of the cointype + account index (m/84'/cointype'/account')
 * the identity is able to sign pset
 */
export class CointypeMnemonic extends Identity
  implements CointypeIdentity<Mnemonic> {
  readonly opts: CointypeMnemonicOpts;
  readonly masterBlindingKey: string;
  readonly accounts: Mnemonic[] = [];

  constructor(args: IdentityOpts<CointypeMnemonicOpts>) {
    super(args);
    if (
      !validateMnemonic(
        args.opts.mnemonic,
        wordlists[args.opts.language || 'english']
      )
    ) {
      throw new Error('Invalid mnemonic');
    }

    checkIdentityType(args.type, IdentityType.CointypeMnemonic);

    const walletSeed = mnemonicToSeedSync(
      args.opts.mnemonic,
      args.opts.passphrase
    );
    // generate the master blinding key from the seed
    const masterBlindingKeyNode = SLIP77Factory(args.ecclib).fromSeed(
      walletSeed
    );
    const masterBlindingKey = masterBlindingKeyNode.masterKey.toString('hex');
    this.opts = args.opts;
    this.masterBlindingKey = masterBlindingKey;
  }

  getAccount(param: CointypeAccount): Mnemonic {
    const path = derivationPathBIP84(param.cointype, param.account);
    const account = this.accounts.find(
      accountKey => accountKey.baseDerivationPath === path
    );
    if (account) return account;
    const newAccount = new Mnemonic({
      chain: this.chain,
      ecclib: this.ecclib,
      type: IdentityType.Mnemonic,
      opts: {
        ...this.opts,
        baseDerivationPath: derivationPathBIP84(param.cointype, param.account),
      },
    });
    this.accounts.push(newAccount);
    return newAccount;
  }

  getNextAddress(params: CointypeAccount): Promise<AddressInterface> {
    return this.getAccount(params).getNextAddress();
  }

  getNextChangeAddress(params: CointypeAccount): Promise<AddressInterface> {
    return this.getAccount(params).getNextChangeAddress();
  }

  async getAddresses(): Promise<AddressInterface[]> {
    const allAddresses = [];
    for (const m of this.accounts) {
      allAddresses.push(...(await m.getAddresses()));
    }
    return allAddresses;
  }

  private getBlindingKeyPair(
    script: string
  ): { publicKey: Buffer; privateKey: Buffer } {
    for (const a of this.accounts) {
      try {
        return a.getBlindingKeyPair(script, true);
      } catch (e) {
        // ignore
      }
    }
    throw new Error('Blinding key pair not found');
  }

  async getBlindingPrivateKey(script: string): Promise<string> {
    const { privateKey } = this.getBlindingKeyPair(script);
    return privateKey.toString('hex');
  }

  isAbleToSign(): boolean {
    return true;
  }

  blindPset(
    psetBase64: string,
    outputsIndexToBlind: number[],
    outputsPubKeysByIndex?: Map<number, string> | undefined,
    inputsBlindingDataLike?: Map<number, BlindingDataLike> | undefined
  ): Promise<string> {
    return super.blindPsetWithBlindKeysGetter(
      (script: Buffer) => this.getBlindingKeyPair(script.toString('hex')),
      psetBase64,
      outputsIndexToBlind,
      outputsPubKeysByIndex,
      inputsBlindingDataLike
    );
  }

  async signPset(pset: string): Promise<string> {
    for (const a of this.accounts) {
      pset = await a.signPset(pset);
    }
    return pset;
  }

  getCointypeWatchOnlyOpts(): CointypeWatchOnlyOpts {
    return {
      masterBlindingKey: this.masterBlindingKey,
      accounts: this.accounts.map(account => ({
        masterPublicKey: account.masterPublicKey,
        derivationPath: account.baseDerivationPath,
      })),
    };
  }
}
