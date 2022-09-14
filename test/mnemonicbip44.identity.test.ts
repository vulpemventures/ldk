import * as assert from 'assert';
import {
  Psbt,
  Transaction,
  confidential,
  networks,
  payments,
  address,
  TxOutput,
  AssetHash,
} from 'liquidjs-lib';
import { BlindingDataLike } from 'liquidjs-lib/src/psbt';
import {
  BIP44MnemonicOpts,
  IdentityOpts,
  IdentityType,
  BIP44Mnemonic,
  MnemonicOpts,
  BIP44restorerFromState,
  BIP44restorerFromEsplora,
} from '../src';
import * as ecc from 'tiny-secp256k1';
import { faucet, fetchTxHex, fetchUtxos } from './_regtest';

const network = networks.regtest;
const lbtc = AssetHash.fromHex(network.assetHash, false);

jest.setTimeout(500_000);

const validOpts: IdentityOpts<BIP44MnemonicOpts> = {
  chain: 'regtest',
  type: IdentityType.BIP44Mnemonic,
  ecclib: ecc,
  opts: {
    mnemonic:
      'barely aerobic fresh half love truck uncle final like seminar clump agree spoon bracket vicious',
  },
};

const validOptsFrench: IdentityOpts<MnemonicOpts> = {
  ...validOpts,
  opts: {
    mnemonic:
      'mutuel ourson soupape vertu atelier dynastie silicium absolu océan légume pyramide skier météore tulipe alchimie élargir gourmand étaler saboter cocotier aisance mairie jeton créditer',
    language: 'french',
  },
};

const unvalidTypeOpts: IdentityOpts<MnemonicOpts> = {
  ...validOpts,
  type: IdentityType.PrivateKey,
};

const unvalidMnemonicOpts: IdentityOpts<MnemonicOpts> = {
  ...validOpts,
  opts: {
    mnemonic: 'tbh nigiri is awesome for Liquid / bitcoin unit testing',
  },
};

describe('Identity: BIP44Mnemonic', () => {
  describe('Constructor', () => {
    const validMnemonic = new BIP44Mnemonic(validOpts);

    it('should build a valid BIP44Mnemonic class if the constructor arguments are valid', () => {
      assert.deepStrictEqual(validMnemonic instanceof BIP44Mnemonic, true);
    });

    it('should work if a language is specified', () => {
      const frenchMnemonic = new BIP44Mnemonic(validOptsFrench);
      assert.deepStrictEqual(frenchMnemonic instanceof BIP44Mnemonic, true);
    });

    it('should throw an error if type is not IdentityType.BIP44Mnemonic', () => {
      assert.throws(() => new BIP44Mnemonic(unvalidTypeOpts));
    });

    it('should throw an error if the mnemonic is unvalid', () => {
      assert.throws(() => new BIP44Mnemonic(unvalidMnemonicOpts));
    });
  });

  describe('BIP44Mnemonic.isAbleToSign', () => {
    it('should return true', () => {
      const mnemonic = new BIP44Mnemonic(validOpts);
      assert.deepStrictEqual(mnemonic.isAbleToSign(), true);
    });
  });

  describe('BIP44Mnemonic.signPset', () => {
    it('should sign the inputs of the previously generated addresses', async () => {
      const mnemonic = new BIP44Mnemonic(validOpts);
      const generated = await mnemonic.getNextAddress({
        cointype: 1776,
        account: 0,
      });

      const { unconfidentialAddress } = address.fromConfidential(
        generated.confidentialAddress
      );
      const txid = await faucet(unconfidentialAddress);
      const utxo = (await fetchUtxos(unconfidentialAddress)).find(
        u => u.txid === txid
      );

      const prevoutHex = await fetchTxHex(utxo.txid);
      const prevout = Transaction.fromHex(prevoutHex).outs[utxo.vout];

      const script: Buffer = address.toOutputScript(unconfidentialAddress);

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
            asset: lbtc.bytes,
          },
          {
            nonce: Buffer.from('00', 'hex'),
            value: confidential.satoshiToConfidentialValue(60000000),
            script: Buffer.alloc(0),
            asset: lbtc.bytes,
          },
        ]);

      const signedBase64 = await mnemonic.signPset(pset.toBase64());
      const signedPsbt = Psbt.fromBase64(signedBase64);
      let isValid = false;
      assert.doesNotThrow(
        () =>
          (isValid = signedPsbt.validateSignaturesOfAllInputs(
            Psbt.ECDSASigValidator(ecc)
          ))
      );
      assert.deepStrictEqual(isValid, true);
    });
  });

  describe('BIP44Mnemonic.blindPset', () => {
    it('should blind the transaction', async () => {
      const mnemonic = new BIP44Mnemonic(validOpts);
      const generated = await mnemonic.getNextAddress({
        cointype: 1776,
        account: 0,
      });

      const txid = await faucet(generated.confidentialAddress);
      const utxo = (await fetchUtxos(generated.confidentialAddress)).find(
        u => u.txid === txid
      );

      const prevoutHex = await fetchTxHex(utxo.txid);
      const prevout = Transaction.fromHex(prevoutHex).outs[utxo.vout];
      const unblindedPrevout = await confidential.unblindOutputWithKey(
        prevout as TxOutput,
        Buffer.from(
          await mnemonic.getBlindingPrivateKey(prevout.script.toString('hex')),
          'hex'
        )
      );

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
            asset: lbtc.bytes,
          },
          {
            nonce: Buffer.from('00', 'hex'),
            value: confidential.satoshiToConfidentialValue(60000000),
            script: Buffer.alloc(0),
            asset: lbtc.bytes,
          },
        ]);

      const blindBase64 = await mnemonic.blindPset(
        pset.toBase64(),
        [0],
        undefined,
        new Map<number, BlindingDataLike>().set(0, unblindedPrevout)
      );
      const signedBase64 = await mnemonic.signPset(blindBase64);
      const signedPsbt = Psbt.fromBase64(signedBase64);
      let isValid = false;
      assert.doesNotThrow(
        () =>
          (isValid = signedPsbt.validateSignaturesOfAllInputs(
            Psbt.ECDSASigValidator(ecc)
          ))
      );
      assert.deepStrictEqual(isValid, true);
    });

    it('should throw an error if one of the output to blind does not contain blinding public key (and it is not an identity script)', async () => {
      const mnemonic = new BIP44Mnemonic(validOpts);
      const generated = await mnemonic.getNextAddress({
        cointype: 1776,
        account: 0,
      });

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
            asset: lbtc.bytes,
          },
          {
            nonce: Buffer.from('00', 'hex'),
            value: confidential.satoshiToConfidentialValue(60000000),
            script: Buffer.alloc(0),
            asset: lbtc.bytes,
          },
        ]);

      assert.rejects(mnemonic.blindPset(pset.toBase64(), [0]));
    });
  });

  describe('BIP44Mnemonic.getAddresses', () => {
    it('should return all the generated addresses', async () => {
      const mnemonic = new BIP44Mnemonic(validOpts);
      const generated1 = await mnemonic.getNextAddress({
        cointype: 1776,
        account: 0,
      });
      const generated2 = await mnemonic.getNextAddress({
        cointype: 1776,
        account: 0,
      });
      assert.deepStrictEqual(
        [generated1, generated2],
        await mnemonic.getAddresses()
      );
    });
  });

  describe('BIP44Mnemonic.getBlindingPrivateKey', () => {
    it('should return the privateKey according to slip77 spec', async () => {
      const mnemonic = new BIP44Mnemonic(validOpts);
      const {
        confidentialAddress,
        blindingPrivateKey,
      } = await mnemonic.getNextAddress({ cointype: 1776, account: 0 });

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
  describe('BIP44Mnemonic restoration', () => {
    describe('BIP44Mnemonic restoration (from Esplora)', () => {
      let mnemonic: BIP44Mnemonic;
      let restoredMnemonic: BIP44Mnemonic;

      beforeAll(async () => {
        const numberOfAddresses = 21;
        mnemonic = new BIP44Mnemonic(validOpts);
        // faucet all the addresses
        for (let i = 0; i < numberOfAddresses; i++) {
          const addr = await mnemonic.getNextAddress({
            cointype: 1776,
            account: 0,
          });
          const changeAddr = await mnemonic.getNextChangeAddress({
            cointype: 1776,
            account: 0,
          });
          if (i === numberOfAddresses - 1) {
            await faucet(addr.confidentialAddress);
            await faucet(changeAddr.confidentialAddress);
          }
        }
        const toRestoreMnemonic = new BIP44Mnemonic({
          ...validOpts,
        });
        restoredMnemonic = await BIP44restorerFromEsplora(toRestoreMnemonic)({
          gapLimit: 30,
          esploraURL: 'http://localhost:3001',
          accounts: [{ cointype: 1776, account: 0 }],
        });
      });

      it('should restore already used addresses', async () => {
        const addrs = await mnemonic.getAddresses();
        const restored = await restoredMnemonic.getAddresses();
        assert.deepStrictEqual(addrs.length, restored.length);
      });

      it('should update the index when restored', async () => {
        const toRestoreAddrs = await restoredMnemonic.getAddresses();
        const addressesKnown = toRestoreAddrs.map(a => a.confidentialAddress);

        const next = await restoredMnemonic.getNextAddress({
          cointype: 1776,
          account: 0,
        });
        const nextIsAlreadyKnownByMnemonic = addressesKnown.includes(
          next.confidentialAddress
        );

        assert.deepStrictEqual(nextIsAlreadyKnownByMnemonic, false);
      });

      it('should update the change index when restored', async () => {
        const toRestoreAddrs = await restoredMnemonic.getAddresses();
        const addressesKnown = toRestoreAddrs.map(a => a.confidentialAddress);

        const next = await restoredMnemonic.getNextChangeAddress({
          cointype: 1776,
          account: 0,
        });
        const nextIsAlreadyKnownByMnemonic = addressesKnown.includes(
          next.confidentialAddress
        );

        assert.deepStrictEqual(nextIsAlreadyKnownByMnemonic, false);
      });
    });

    describe('BIP44Mnemonic restoration (from State)', () => {
      const restorer = BIP44restorerFromState<BIP44Mnemonic>(
        new BIP44Mnemonic({
          ...validOpts,
        })
      );

      it('should update the index when restored', async () => {
        const restored = await restorer([
          {
            cointype: 1776,
            account: 0,
            lastUsedExternalIndex: 15,
            lastUsedInternalIndex: 4,
          },
        ]);

        assert.deepStrictEqual(
          (await restored.getNextAddress({ cointype: 1776, account: 0 }))
            .derivationPath,
          "m/44'/1776'/0'/0/16"
        );
      });
    });
  });
});
