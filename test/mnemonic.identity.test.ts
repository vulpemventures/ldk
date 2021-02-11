import * as assert from 'assert';

import { IdentityOpts, IdentityType } from '../src/identity/identity';
import {
  Psbt,
  Transaction,
  confidential,
  networks,
  payments,
} from 'liquidjs-lib';
import { faucet, fetchTxHex, fetchUtxos } from './_regtest';

import { EsploraIdentityRestorer } from '../src/identity/identityRestorer';
import { Mnemonic } from '../src/identity/mnemonic';
import { fromSeed as bip32fromSeed } from 'bip32';
import { mnemonicToSeedSync } from 'bip39';
import { fromSeed as slip77fromSeed } from 'slip77';

const network = networks.regtest;

jest.setTimeout(60000);

const validOpts: IdentityOpts = {
  chain: 'regtest',
  type: IdentityType.Mnemonic,
  value: {
    mnemonic:
      'pause quantum three welcome become episode tackle achieve predict mimic share task onion vapor announce exist inner fortune stamp crucial angle neither manage denial',
  },
};

const seedFromValidMnemonic = mnemonicToSeedSync(validOpts.value.mnemonic);
const masterPrivateKeyFromValidMnemonic = bip32fromSeed(
  seedFromValidMnemonic,
  network
);
const masterBlindingKeyFromValidMnemonic = slip77fromSeed(
  seedFromValidMnemonic
);

const validOptsFrench: IdentityOpts = {
  ...validOpts,
  value: {
    mnemonic:
      'mutuel ourson soupape vertu atelier dynastie silicium absolu océan légume pyramide skier météore tulipe alchimie élargir gourmand étaler saboter cocotier aisance mairie jeton créditer',
    language: 'french',
  },
};

const unvalidLanguageOpts: IdentityOpts = {
  ...validOpts,
  value: {
    ...validOpts.value,
    language: 'corsican',
  },
};

const unvalidTypeOpts: IdentityOpts = {
  ...validOpts,
  type: IdentityType.PrivateKey,
};

const unvalidValueOpts: IdentityOpts = {
  ...validOpts,
  value: { vulpem: 'company', language: 'italian' },
};

const unvalidMnemonicOpts: IdentityOpts = {
  ...validOpts,
  value: {
    mnemonic: 'tbh nigiri is awesome for Liquid / bitcoin unit testing',
  },
};

describe('Identity: Private key', () => {
  describe('Constructor', () => {
    const validMnemonic = new Mnemonic(validOpts);

    it('should build a valid Mnemonic class if the constructor arguments are valid', () => {
      assert.deepStrictEqual(validMnemonic instanceof Mnemonic, true);
    });

    it('should generate a slip77 master blinding key and a bip32 master private key from the mnemonic', () => {
      assert.deepStrictEqual(
        validMnemonic.masterBlindingKeyNode.privateKey,
        masterBlindingKeyFromValidMnemonic.privateKey
      );
      assert.deepStrictEqual(
        validMnemonic.masterPrivateKeyNode.privateKey,
        masterPrivateKeyFromValidMnemonic.privateKey
      );
    });

    it('should work if a language is specified', () => {
      const frenchMnemonic = new Mnemonic(validOptsFrench);
      assert.deepStrictEqual(frenchMnemonic instanceof Mnemonic, true);
    });

    it('should throw an error if type is not IdentityType.Mnemonic', () => {
      assert.throws(() => new Mnemonic(unvalidTypeOpts));
    });

    it('should throw an error if value of IdentityOpts is not of type {mnemonic: string; language?: string;}', () => {
      assert.throws(() => new Mnemonic(unvalidValueOpts));
    });

    it('should throw an error if the language is unvalid (i.e has no wordlist available)', () => {
      assert.throws(() => new Mnemonic(unvalidLanguageOpts));
    });

    it('should throw an error if the mnemonic is unvalid', () => {
      assert.throws(() => new Mnemonic(unvalidMnemonicOpts));
    });
  });

  describe('Mnemonic.isAbleToSign', () => {
    it('should return true', () => {
      const mnemonic = new Mnemonic(validOpts);
      assert.deepStrictEqual(mnemonic.isAbleToSign(), true);
    });
  });

  describe('Mnemonic.signPset', () => {
    it('should sign the inputs of the previously generated addresses', async () => {
      const mnemonic = new Mnemonic(validOpts);
      const generated = mnemonic.getNextAddress();

      await faucet(generated.confidentialAddress);
      const utxo = (await fetchUtxos(generated.confidentialAddress))[0];

      const prevoutHex = await fetchTxHex(utxo.txid);
      const prevout = Transaction.fromHex(prevoutHex).outs[utxo.vout];
      const unblindedUtxo = await confidential.unblindOutputWithKey(
        prevout,
        Buffer.from(generated.blindingPrivateKey, 'hex')
      );

      const script: Buffer = payments.p2wpkh({
        confidentialAddress: generated.confidentialAddress,
        network,
      }).output!;

      const pset: Psbt = new Psbt({ network })
        .addInput({
          hash: utxo.txid,
          index: utxo.vout,
          witnessUtxo: {
            nonce: Buffer.from('00', 'hex'),
            value: confidential.satoshiToConfidentialValue(
              parseInt(unblindedUtxo.value, 10)
            ),
            asset: unblindedUtxo.asset,
            script,
          },
        })
        .addOutputs([
          {
            nonce: Buffer.from('00', 'hex'),
            value: confidential.satoshiToConfidentialValue(49999500),
            script,
            asset: network.assetHash,
          },
          {
            nonce: Buffer.from('00', 'hex'),
            value: confidential.satoshiToConfidentialValue(60000000),
            script: Buffer.alloc(0),
            asset: network.assetHash,
          },
        ]);

      const signedBase64 = await mnemonic.signPset(pset.toBase64());
      const signedPsbt = Psbt.fromBase64(signedBase64);
      let isValid: boolean = false;
      assert.doesNotThrow(
        () => (isValid = signedPsbt.validateSignaturesOfAllInputs())
      );
      assert.deepStrictEqual(isValid, true);
    });
  });

  describe('Mnemonic.blindPset', () => {
    it('should blind the transaction', async () => {
      const mnemonic = new Mnemonic(validOpts);
      const generated = mnemonic.getNextAddress();

      await faucet(generated.confidentialAddress);
      const utxo = (await fetchUtxos(generated.confidentialAddress))[0];

      const prevoutHex = await fetchTxHex(utxo.txid);
      const prevout = Transaction.fromHex(prevoutHex).outs[utxo.vout];

      const script: Buffer = payments.p2wpkh({
        confidentialAddress: generated.confidentialAddress,
        network,
      }).output!;

      const pset: Psbt = new Psbt({ network })
        .addInput({
          hash: utxo.txid,
          index: utxo.vout,
          witnessUtxo: prevout,
        })
        .addOutputs([
          {
            nonce: Buffer.from('00', 'hex'),
            value: confidential.satoshiToConfidentialValue(49999500),
            script,
            asset: network.assetHash,
          },
          {
            nonce: Buffer.from('00', 'hex'),
            value: confidential.satoshiToConfidentialValue(60000000),
            script: Buffer.alloc(0),
            asset: network.assetHash,
          },
        ]);

      const blindBase64 = await mnemonic.blindPset(pset.toBase64(), [0]);
      const signedBase64 = await mnemonic.signPset(blindBase64);
      const signedPsbt = Psbt.fromBase64(signedBase64);
      let isValid: boolean = false;
      assert.doesNotThrow(
        () => (isValid = signedPsbt.validateSignaturesOfAllInputs())
      );
      assert.deepStrictEqual(isValid, true);
    });
  });

  describe('Mnemonic.getAddresses', () => {
    it('should return all the generated addresses', () => {
      const mnemonic = new Mnemonic(validOpts);
      const generated1 = mnemonic.getNextAddress();
      const generated2 = mnemonic.getNextAddress();
      assert.deepStrictEqual([generated1, generated2], mnemonic.getAddresses());
    });
  });

  describe('Mnemonic.getBlindingPrivateKey', () => {
    it('should return the privateKey according to slip77 spec', () => {
      const mnemonic = new Mnemonic(validOpts);
      const {
        confidentialAddress,
        blindingPrivateKey,
      } = mnemonic.getNextAddress();

      const script: string = payments
        .p2wpkh({
          confidentialAddress,
          network,
        })
        .output!.toString('hex');

      assert.deepStrictEqual(
        mnemonic.getBlindingPrivateKey(script),
        blindingPrivateKey
      );
    });
  });

  describe('Mnemonic.restore', () => {
    let mnemonic: Mnemonic;
    let toRestoreMnemonic: Mnemonic;

    beforeAll(async () => {
      const numberOfAddresses = 2;
      mnemonic = new Mnemonic(validOpts);
      // faucet all the addresses
      for (let i = 0; i < numberOfAddresses; i++) {
        const addr = mnemonic.getNextAddress();
        const changeAddr = mnemonic.getNextChangeAddress();
        await faucet(addr.confidentialAddress);
        await faucet(changeAddr.confidentialAddress);
      }

      toRestoreMnemonic = new Mnemonic({
        ...validOpts,
        initializeFromRestorer: true,
        restorer: new EsploraIdentityRestorer('http://localhost:3001'),
      });

      await toRestoreMnemonic.isRestored;
    });

    it('should restore already used addresses', () => {
      assert.deepStrictEqual(
        mnemonic
          .getAddresses()
          .map(a => a.confidentialAddress)
          .sort(),
        toRestoreMnemonic
          .getAddresses()
          .map(a => a.confidentialAddress)
          .sort()
      );
    });

    it('should update the index when restored', () => {
      const addressesKnown = toRestoreMnemonic
        .getAddresses()
        .map(a => a.confidentialAddress);

      const next = toRestoreMnemonic.getNextAddress();
      const nextIsAlreadyKnownByMnemonic = addressesKnown.includes(
        next.confidentialAddress
      );

      assert.deepStrictEqual(nextIsAlreadyKnownByMnemonic, false);
    });

    it('should update the change index when restored', () => {
      const addressesKnown = toRestoreMnemonic
        .getAddresses()
        .map(a => a.confidentialAddress);

      const next = toRestoreMnemonic.getNextChangeAddress();
      const nextIsAlreadyKnownByMnemonic = addressesKnown.includes(
        next.confidentialAddress
      );

      assert.deepStrictEqual(nextIsAlreadyKnownByMnemonic, false);
    });
  });
});
