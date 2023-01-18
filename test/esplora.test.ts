import * as assert from 'assert';
import ECPairFactory from 'ecpair';
import { address, networks } from 'liquidjs-lib';
import * as ecc from 'tiny-secp256k1';
import {
  AddressInterface,
  balances,
  fetchAndUnblindTxs,
  fetchAndUnblindUtxos,
  getScripts,
  isUnblindedOutput,
  Mnemonic,
  Output,
  utxosFromTransactions,
} from '../src';
// @ts-ignore
import { newRandomMnemonic } from './fixtures/wallet.keys';
// @ts-ignore
import { APIURL, faucet, sleep } from './_regtest';
import { ZKPInterface } from 'liquidjs-lib/src/confidential';
import secp256k1 from '@vulpemventures/secp256k1-zkp';

jest.setTimeout(80000);

describe('esplora', () => {
  let txid: string;
  let senderAddress: AddressInterface;
  let unconfidentialSenderAddress: string;
  let zkplib: ZKPInterface;

  beforeAll(async () => {
    const sender = await newRandomMnemonic();
    senderAddress = await sender.getNextAddress();
    unconfidentialSenderAddress = address.fromConfidential(
      senderAddress.confidentialAddress
    ).unconfidentialAddress;

    txid = await faucet(senderAddress.confidentialAddress);
    await faucet(unconfidentialSenderAddress);
    zkplib = await secp256k1();
  });

  describe('fetchAndUnblindUtxos', () => {
    it('should fetch the utxo prevout, even if unconfidential address is provided', async () => {
      const senderUtxos = await fetchAndUnblindUtxos(
        ecc,
        zkplib,
        [
          {
            confidentialAddress: senderAddress.confidentialAddress,
            blindingPrivateKey: senderAddress.blindingPrivateKey,
          },
        ],
        APIURL
      );

      const withPrevouts = senderUtxos.filter(u => u.prevout);
      assert.deepStrictEqual(withPrevouts.length, senderUtxos.length);
    });

    it('should fetch the utxos, even if wrong blinding key is provided', async () => {
      const senderUtxos = await fetchAndUnblindUtxos(
        ecc,
        zkplib,
        [
          {
            confidentialAddress: senderAddress.confidentialAddress,
            blindingPrivateKey: ECPairFactory(ecc)
              .makeRandom()
              .privateKey!.toString('hex'),
          },
        ],
        APIURL
      );
      assert.deepStrictEqual(senderUtxos.length, 0);
    });

    it('should unblind utxos if the blinding key is provided', async () => {
      const senderUtxos = await fetchAndUnblindUtxos(
        ecc,
        zkplib,
        [
          {
            confidentialAddress: senderAddress.confidentialAddress,
            blindingPrivateKey: senderAddress.blindingPrivateKey,
          },
        ],
        APIURL
      );

      const faucetUtxo = senderUtxos.find(utxo => utxo.txid === txid);
      assert.deepStrictEqual(isUnblindedOutput(faucetUtxo!), true);
    });

    it('should skip unblinding step if the skip predicate returns true', async () => {
      const senderUtxos = await fetchAndUnblindUtxos(
        ecc,
        zkplib,
        [
          {
            confidentialAddress: senderAddress.confidentialAddress,
            blindingPrivateKey: senderAddress.blindingPrivateKey,
          },
        ],
        APIURL,
        // with this skip predicate, `txid` utxos won't be unblinded
        (utxo: Output) => utxo.txid === txid
      );

      const faucetUtxo = senderUtxos.find(utxo => utxo.txid === txid);
      assert.deepStrictEqual(faucetUtxo, undefined);
    });
  });

  describe('fetchAndUnblindTxs', () => {
    it('should return txs if the blinding key is provided', async () => {
      const senderTxs = await fetchAndUnblindTxs(
        [senderAddress.confidentialAddress],
        (script: string) => {
          if (
            address
              .toOutputScript(senderAddress.confidentialAddress)
              .equals(Buffer.from(script, 'hex'))
          ) {
            return senderAddress.blindingPrivateKey;
          } else return undefined;
        },
        APIURL,
        zkplib
      );

      const faucetTx = senderTxs.find(t => t.txid === txid);
      assert.notStrictEqual(faucetTx, undefined);
    });
    it('should skip transaction specified by skip function (and does not return it)', async () => {
      const senderTxs = await fetchAndUnblindTxs(
        [senderAddress.confidentialAddress],
        () => senderAddress.blindingPrivateKey,
        APIURL,
        zkplib,
        tx => tx.txid === txid
      );

      const faucetTx = senderTxs.find(t => t.txid === txid);
      assert.strictEqual(faucetTx, undefined);
    });

    it('should work with duplicate addresses', async () => {
      const senderTxs = await fetchAndUnblindTxs(
        [senderAddress.confidentialAddress],
        (script: string) => {
          if (
            address
              .toOutputScript(senderAddress.confidentialAddress)
              .equals(Buffer.from(script, 'hex'))
          ) {
            return senderAddress.blindingPrivateKey;
          } else return undefined;
        },
        APIURL,
        zkplib
      );

      const faucetTx = senderTxs.find(t => t.txid === txid);
      assert.notStrictEqual(faucetTx, undefined);
    });
  });

  describe('unspents from transactions', () => {
    it('should compute utxos set from transactions', async () => {
      const identity = Mnemonic.Random('regtest', ecc, zkplib);
      const address0 = await identity.getNextAddress();
      const address1 = await identity.getNextAddress();

      await faucet(address0.confidentialAddress);
      await faucet(address1.confidentialAddress);
      sleep(3000);

      const txs = await fetchAndUnblindTxs(
        [address1, address0].map(a => a.confidentialAddress),
        (script: string) => {
          if (
            address
              .toOutputScript(address0.confidentialAddress)
              .equals(Buffer.from(script, 'hex'))
          ) {
            return address0.blindingPrivateKey;
          } else if (
            address
              .toOutputScript(address1.confidentialAddress)
              .equals(Buffer.from(script, 'hex'))
          ) {
            return address1.blindingPrivateKey;
          } else return undefined;
        },
        APIURL,
        zkplib
      );

      const utxos = utxosFromTransactions(
        txs,
        getScripts([address0, address1])
      );
      assert.deepStrictEqual(utxos.length, 2);
      const balance = balances(utxos);
      assert.deepStrictEqual(balance[networks.regtest.assetHash], 2_0000_0000);
    });
  });
});
