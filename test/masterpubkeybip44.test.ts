import * as assert from 'assert';
import { networks, payments } from 'liquidjs-lib';
import * as ecc from 'tiny-secp256k1';
import {
  IdentityOpts,
  IdentityType,
  BIP44MasterPublicKey,
  BIP44MasterPublicKeyOpts,
  BIP44restorerFromEsplora,
} from '../src';
import { faucet, sleep } from './_regtest';

jest.setTimeout(60000);

const validOpts: IdentityOpts<BIP44MasterPublicKeyOpts> = {
  chain: 'regtest',
  ecclib: ecc,
  type: IdentityType.BIP44MasterPublicKey,
  opts: {
    masterBlindingKey:
      '0b7616adc564e4d155453f086f7b7f41dbcb56b343b740746dec06d9b61c31aa',
    accounts: [
      {
        masterPublicKey:
          'xpub6DR4jgbx6dunzs4EXDfRZ6qHNFbkDmZqryUJK2xiH9fWtNuzZ3nob42hCDNqXbqE1ChEhJTPzyU3eADFDJpg3YmKG5ZVDczn7HuwP7wm5QD',
        derivationPath: "m/44'/1776'/0'",
      },
    ],
  },
};

const invalidKeysOpts: IdentityOpts<BIP44MasterPublicKeyOpts> = {
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

const wrongTypeOpts: IdentityOpts<BIP44MasterPublicKeyOpts> = {
  ...validOpts,
  type: IdentityType.Mnemonic,
};

describe('Identity: Master Pub Key', () => {
  describe('Constructor', () => {
    it('should build a valid MasterPubkey class instance if the constructor arguments are valid', () => {
      const pubKey = new BIP44MasterPublicKey(validOpts);
      assert.deepStrictEqual(pubKey instanceof BIP44MasterPublicKey, true);
    });

    it('should throw an error if the identity type is not IdentityType.MasterPubKey', () => {
      assert.throws(() => new BIP44MasterPublicKey(wrongTypeOpts));
    });

    it('should throw an error if the masterPublicKey and masterBlindingKey are not valid key', () => {
      assert.throws(() => new BIP44MasterPublicKey(invalidKeysOpts));
    });
  });

  describe('isAbleToSign', () => {
    it('should return false', () => {
      const pubKey = new BIP44MasterPublicKey(validOpts);
      assert.deepStrictEqual(pubKey.isAbleToSign(), false);
    });
  });

  describe('MasterPubKey.signPset', () => {
    it('should throw an error', () => {
      const pubKey = new BIP44MasterPublicKey(validOpts);
      assert.throws(() => pubKey.signPset(''));
    });
  });

  describe('MasterPubKey.getAddresses', () => {
    it('should return all the generated addresses', async () => {
      const pubKey = new BIP44MasterPublicKey(validOpts);
      const addr0 = await pubKey.getNextAddress({ cointype: 1776, account: 0 });
      const addr1 = await pubKey.getNextAddress({ cointype: 1776, account: 0 });

      const addresses = await pubKey.getAddresses();

      assert.deepStrictEqual(addresses.sort(), [addr0, addr1].sort());
    });

    it('should throw an error if account is unknown', async () => {
      const pubKey = new BIP44MasterPublicKey(validOpts);
      assert.throws(() =>
        pubKey.getNextAddress({ cointype: 1776, account: 1 })
      );
    });

    it('should throw an error if coinType is unknown', async () => {
      const pubKey = new BIP44MasterPublicKey(validOpts);
      assert.throws(() => pubKey.getNextAddress({ cointype: 0, account: 0 }));
    });
  });

  describe('MasterPubKey.getBlindingPrivateKey', () => {
    it('should return privateKey according to slip77 spec', async () => {
      const pubKey = new BIP44MasterPublicKey(validOpts);

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
    let pubkey: BIP44MasterPublicKey;
    let restoredPubKey: BIP44MasterPublicKey;

    beforeAll(async () => {
      const numberOfAddresses = 2;
      pubkey = new BIP44MasterPublicKey(validOpts);
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

      const toRestorePubKey = new BIP44MasterPublicKey({ ...validOpts });
      restoredPubKey = await BIP44restorerFromEsplora(toRestorePubKey)({
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
