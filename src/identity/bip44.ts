import { mnemonicToSeedSync, validateMnemonic, wordlists } from 'bip39';
import { BlindingDataLike } from 'liquidjs-lib';
import { SLIP77Factory } from 'slip77';
import { AddressInterface, IdentityType } from '../types';
import { checkIdentityType } from '../utils';
import { Identity, IdentityInterface, IdentityOpts } from './identity';
import { MasterPublicKey, MasterPublicKeyOpts } from './masterpubkey';
import { Mnemonic, MnemonicOpts } from './mnemonic';

// Params needed by BIP44 address derivation
// defines an hardened coin account derivation path
// use "type" instead of "interface" to be compliant with identityInterface
export type BIP44Account = {
  cointype: number;
  account: number;
};

export interface MasterKeyWithAccountPath {
  masterPublicKey: MasterPublicKeyOpts['masterPublicKey'];
  derivationPath: string;
}

export interface BIP44MasterPublicKeyOpts {
  accounts: MasterKeyWithAccountPath[];
  masterBlindingKey: MasterPublicKeyOpts['masterBlindingKey'];
}

export function derivationPathBIP44(cointype: number, account: number) {
  return `m/44'/${cointype}'/${account}'`;
}

export class BIP44NoAccountError extends Error {
  constructor(account: number, coinType: number) {
    super(`No account #${account} for coin type ${coinType}`);
  }
}

export type BIP44Identity<
  T extends MasterPublicKey = MasterPublicKey
> = IdentityInterface & {
  getAccount: (opts: BIP44Account) => T;
  accounts: T[];
};

export class BIP44MasterPublicKey extends Identity
  implements BIP44Identity<MasterPublicKey> {
  readonly accounts: MasterPublicKey[] = [];

  constructor(args: IdentityOpts<BIP44MasterPublicKeyOpts>) {
    super(args);
    checkIdentityType(args.type, IdentityType.BIP44MasterPublicKey);
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

  getAccount(param: BIP44Account): MasterPublicKey {
    const masterPublicKey = this.accounts.find(masterPublicKey => {
      return (
        masterPublicKey.baseDerivationPath ===
        derivationPathBIP44(param.cointype, param.account)
      );
    });
    if (!masterPublicKey) {
      throw new BIP44NoAccountError(param.account, param.cointype);
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

  getNextAddress(params: BIP44Account): Promise<AddressInterface> {
    return this.getAccount(params).getNextAddress();
  }

  getNextChangeAddress(params: BIP44Account): Promise<AddressInterface> {
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

export type BIP44MnemonicOpts = Omit<MnemonicOpts, 'baseDerivationPath'>;

export class BIP44Mnemonic extends Identity implements BIP44Identity<Mnemonic> {
  readonly opts: BIP44MnemonicOpts;
  readonly masterBlindingKey: string;
  readonly accounts: Mnemonic[] = [];

  constructor(args: IdentityOpts<BIP44MnemonicOpts>) {
    super(args);
    if (
      !validateMnemonic(
        args.opts.mnemonic,
        wordlists[args.opts.language || 'english']
      )
    ) {
      throw new Error('Invalid mnemonic');
    }

    checkIdentityType(args.type, IdentityType.BIP44Mnemonic);

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

  getAccount(param: BIP44Account): Mnemonic {
    const path = derivationPathBIP44(param.cointype, param.account);
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
        baseDerivationPath: derivationPathBIP44(param.cointype, param.account),
      },
    });
    this.accounts.push(newAccount);
    return newAccount;
  }

  getNextAddress(params: BIP44Account): Promise<AddressInterface> {
    return this.getAccount(params).getNextAddress();
  }

  getNextChangeAddress(params: BIP44Account): Promise<AddressInterface> {
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

  getBIP44MasterPublicKeyOpts(): BIP44MasterPublicKeyOpts {
    return {
      masterBlindingKey: this.masterBlindingKey,
      accounts: this.accounts.map(account => ({
        masterPublicKey: account.masterPublicKey,
        derivationPath: account.baseDerivationPath,
      })),
    };
  }
}
