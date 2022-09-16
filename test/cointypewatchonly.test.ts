import * as assert from 'assert';
import { networks, payments } from 'liquidjs-lib';
import * as ecc from 'tiny-secp256k1';
import {
  IdentityOpts,
  IdentityType,
  CointypeWatchOnly,
  CointypeWatchOnlyOpts,
  cointypeRestorerFromEsplora,
} from '../src';
import { faucet, sleep } from './_regtest';

jest.setTimeout(60000);

const validOpts: IdentityOpts<CointypeWatchOnlyOpts> = {
  chain: 'regtest',
  ecclib: ecc,
  type: IdentityType.CointypeWatchOnly,
  opts: {
    masterBlindingKey:
      '421e0d75a1b27143dab957e9f2a41712a885e3b6332abfb4063a719ddac5125f',
    accounts: [
      {
        masterPublicKey:
          'xpub6BpYi2MgsY6a2DJmfjmHT6BhKLRRHaET7oDxPPyMRFM6CgMymhThfUbgWXXrAasHi9jnRufXmuGUcg4CwwSTNRe5onEGKmhE5XNBHZTpUUu',
        derivationPath: "m/84'/1776'/0'",
      },
    ],
  },
};

const invalidKeysOpts: IdentityOpts<CointypeWatchOnlyOpts> = {
  ...validOpts,
  opts: {
    accounts: [
      {
        masterPublicKey: "I'm not a good pub key",
        derivationPath: "m/44'/1776'/0'",
      },
    ],
    masterBlindingKey: "i'm not a hex encoded blindingkey éç",
  },
};

const wrongTypeOpts: IdentityOpts<CointypeWatchOnlyOpts> = {
  ...validOpts,
  type: IdentityType.Mnemonic,
};

describe('Identity: Master Pub Key', () => {
  describe('Constructor', () => {
    it('should build a valid MasterPubkey class instance if the constructor arguments are valid', () => {
      const pubKey = new CointypeWatchOnly(validOpts);
      assert.deepStrictEqual(pubKey instanceof CointypeWatchOnly, true);
    });

    it('should throw an error if the identity type is not IdentityType.MasterPubKey', () => {
      assert.throws(() => new CointypeWatchOnly(wrongTypeOpts));
    });

    it('should throw an error if the masterPublicKey and masterBlindingKey are not valid key', () => {
      assert.throws(() => new CointypeWatchOnly(invalidKeysOpts));
    });
  });

  describe('isAbleToSign', () => {
    it('should return false', () => {
      const pubKey = new CointypeWatchOnly(validOpts);
      assert.deepStrictEqual(pubKey.isAbleToSign(), false);
    });
  });

  describe('MasterPubKey.signPset', () => {
    it('should throw an error', () => {
      const pubKey = new CointypeWatchOnly(validOpts);
      assert.throws(() => pubKey.signPset(''));
    });
  });

  describe('MasterPubKey.getAddresses', () => {
    it('should return all the generated addresses', async () => {
      const pubKey = new CointypeWatchOnly(validOpts);
      const addr0 = await pubKey.getNextAddress({ cointype: 1776, account: 0 });
      const addr1 = await pubKey.getNextAddress({ cointype: 1776, account: 0 });

      const addresses = await pubKey.getAddresses();

      assert.deepStrictEqual(addresses.sort(), [addr0, addr1].sort());
    });

    it('should throw an error if account is unknown', async () => {
      const pubKey = new CointypeWatchOnly(validOpts);
      assert.throws(() =>
        pubKey.getNextAddress({ cointype: 1776, account: 1 })
      );
    });

    it('should throw an error if coinType is unknown', async () => {
      const pubKey = new CointypeWatchOnly(validOpts);
      assert.throws(() => pubKey.getNextAddress({ cointype: 0, account: 0 }));
    });
  });

  describe('MasterPubKey.getBlindingPrivateKey', () => {
    it('should return privateKey according to slip77 spec', async () => {
      const pubKey = new CointypeWatchOnly(validOpts);

      const {
        confidentialAddress,
        blindingPrivateKey,
      } = await pubKey.getNextAddress({ cointype: 1776, account: 0 });

      const script: string = payments
        .p2wpkh({
          confidentialAddress,
          network: networks.regtest,
        })
        .output!.toString('hex');

      assert.deepStrictEqual(
        await pubKey.getBlindingPrivateKey(script),
        blindingPrivateKey
      );
    });
  });

  describe('MasterPubKey.restore', () => {
    let pubkey: CointypeWatchOnly;
    let restoredPubKey: CointypeWatchOnly;

    beforeAll(async () => {
      const numberOfAddresses = 2;
      pubkey = new CointypeWatchOnly(validOpts);
      // faucet all the addresses
      for (let i = 0; i < numberOfAddresses; i++) {
        const addr = await pubkey.getNextAddress({
          cointype: 1776,
          account: 0,
        });
        const changeAddr = await pubkey.getNextChangeAddress({
          cointype: 1776,
          account: 0,
        });
        await faucet(addr.confidentialAddress);
        await faucet(changeAddr.confidentialAddress);
      }
      await sleep(3000);

      const toRestorePubKey = new CointypeWatchOnly({ ...validOpts });
      restoredPubKey = await cointypeRestorerFromEsplora(toRestorePubKey)({
        gapLimit: 20,
        esploraURL: 'http://localhost:3001',
        accounts: [{ account: 0, cointype: 1776 }],
      });
    });

    it('should restore already used addresses', async () => {
      const pubKeyAddrs = await pubkey.getAddresses();
      const toRestoreAddrs = await restoredPubKey.getAddresses();
      assert.deepStrictEqual(toRestoreAddrs.length, pubKeyAddrs.length);
    });

    it('should update the index when restored', async () => {
      const addrs = await restoredPubKey.getAddresses();
      const addressesKnown = addrs.map(a => a.confidentialAddress);

      const next = await restoredPubKey.getNextAddress({
        cointype: 1776,
        account: 0,
      });
      const nextIsAlreadyKnown = addressesKnown.includes(
        next.confidentialAddress
      );

      assert.deepStrictEqual(nextIsAlreadyKnown, false);
    });

    it('should update the change index when restored', async () => {
      const addrs = await restoredPubKey.getAddresses();
      const addressesKnown = addrs.map(a => a.confidentialAddress);

      const next = await restoredPubKey.getNextChangeAddress({
        cointype: 1776,
        account: 0,
      });
      const nextIsAlreadyKnown = addressesKnown.includes(
        next.confidentialAddress
      );

      assert.deepStrictEqual(nextIsAlreadyKnown, false);
    });
  });
});
