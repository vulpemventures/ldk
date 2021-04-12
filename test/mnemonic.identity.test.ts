import * as assert from 'assert';
import {
  EsploraIdentityRestorer,
  IdentityOpts,
  IdentityType,
  Mnemonic,
} from '../src';
import {
  Psbt,
  Transaction,
  confidential,
  networks,
  payments,
} from 'liquidjs-lib';
import { faucet, fetchTxHex, fetchUtxos } from './_regtest';
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

describe('Identity: Mnemonic', () => {
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
      const generated = await mnemonic.getNextAddress();

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
      const generated = await mnemonic.getNextAddress();

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

    it('should throw an error if one of the output to blind does not contain blinding public key (and it is not an identity script)', async () => {
      const mnemonic = new Mnemonic(validOpts);
      const generated = await mnemonic.getNextAddress();

      await faucet(generated.confidentialAddress);
      const utxo = (await fetchUtxos(generated.confidentialAddress))[0];

      const prevoutHex = await fetchTxHex(utxo.txid);
      const prevout = Transaction.fromHex(prevoutHex).outs[utxo.vout];

      const script = Buffer.from(
        '00140619adc71daf50734f660bb2ee9aef37825b81fe',
        'hex'
      ); // non wallet script

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

      assert.rejects(mnemonic.blindPset(pset.toBase64(), [0]));
    });
  });

  describe('Mnemonic.getAddresses', () => {
    it('should have private method getAddress return an AddressInterfaceExtended', () => {
      const mnemonic = new Mnemonic(validOpts);
      const addressExtended = mnemonic['getAddress'](false, 42);
      assert.deepStrictEqual(addressExtended, {
        address: {
          blindingPrivateKey:
            'a72f1d64dafd471bde9447f1358c3011961c318749d1b35cd34de8233abcc492',
          confidentialAddress:
            'el1qqtvm33xtfrnusggyarpjsj20hphwwlduvlwvvufk387rhu74u95snxpe2shf9zg2ck6ah3l2wterg0c0chxtyka5dpy37wshr',
          derivationPath: "m/84'/0'/0'/0/42",
        },
        publicKey:
          '03cc94a5ccfeafe3c6f9a15cc821ac197d1112f0c066673117b239524da6c66320',
      });
    });

    it('should return all the generated addresses', async () => {
      const mnemonic = new Mnemonic(validOpts);
      const generated1 = await mnemonic.getNextAddress();
      const generated2 = await mnemonic.getNextAddress();
      assert.deepStrictEqual(
        [generated1, generated2],
        await mnemonic.getAddresses()
      );
    });
  });

  describe('Mnemonic.getBlindingPrivateKey', () => {
    it('should return the privateKey according to slip77 spec', async () => {
      const mnemonic = new Mnemonic(validOpts);
      const {
        confidentialAddress,
        blindingPrivateKey,
      } = await mnemonic.getNextAddress();

      const script: string = payments
        .p2wpkh({
          confidentialAddress,
          network,
        })
        .output!.toString('hex');

      assert.deepStrictEqual(
        await mnemonic.getBlindingPrivateKey(script),
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
        const addr = await mnemonic.getNextAddress();
        const changeAddr = await mnemonic.getNextChangeAddress();
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

    it('should restore already used addresses', async () => {
      const addrs = await mnemonic.getAddresses();
      const toRestoreAddrs = await toRestoreMnemonic.getAddresses();
      assert.deepStrictEqual(
        addrs.map(a => a.confidentialAddress).sort(),
        toRestoreAddrs.map(a => a.confidentialAddress).sort()
      );
    });

    it('should update the index when restored', async () => {
      const toRestoreAddrs = await toRestoreMnemonic.getAddresses();
      const addressesKnown = toRestoreAddrs.map(a => a.confidentialAddress);

      const next = await toRestoreMnemonic.getNextAddress();
      const nextIsAlreadyKnownByMnemonic = addressesKnown.includes(
        next.confidentialAddress
      );

      assert.deepStrictEqual(nextIsAlreadyKnownByMnemonic, false);
    });

    it('should update the change index when restored', async () => {
      const toRestoreAddrs = await toRestoreMnemonic.getAddresses();
      const addressesKnown = toRestoreAddrs.map(a => a.confidentialAddress);

      const next = await toRestoreMnemonic.getNextChangeAddress();
      const nextIsAlreadyKnownByMnemonic = addressesKnown.includes(
        next.confidentialAddress
      );

      assert.deepStrictEqual(nextIsAlreadyKnownByMnemonic, false);
    });
  });
});
