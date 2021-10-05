import * as assert from 'assert';
import { address, ECPair } from 'liquidjs-lib';

import {
  AddressInterface,
  fetchAndUnblindTxs,
  fetchAndUnblindUtxos,
  fetchPrevoutAndTryToUnblindUtxo,
  isBlindedUtxo,
  UtxoInterface,
} from '../src';

import { APIURL, faucet } from './_regtest';
import { newRandomMnemonic } from './fixtures/wallet.keys';

jest.setTimeout(80000);

describe('esplora', () => {
  let txid: string;
  let senderAddress: AddressInterface;
  let unconfidentialSenderAddress: string;

  beforeAll(async () => {
    const sender = newRandomMnemonic();
    senderAddress = await sender.getNextAddress();
    unconfidentialSenderAddress = address.fromConfidential(
      senderAddress.confidentialAddress
    ).unconfidentialAddress;

    txid = await faucet(senderAddress.confidentialAddress);
    await faucet(unconfidentialSenderAddress);
  });

  describe('fetchAndUnblindUtxos', () => {
    it('should fetch the utxo prevout, even if unconfidential address is provided', async () => {
      const senderUtxos = await fetchAndUnblindUtxos(
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
        [
          {
            confidentialAddress: senderAddress.confidentialAddress,
            blindingPrivateKey: ECPair.makeRandom().privateKey!.toString('hex'),
          },
        ],
        APIURL
      );
      assert.deepStrictEqual(senderUtxos.length, 0);
    });

    it('should unblind utxos if the blinding key is provided', async () => {
      const senderUtxos = await fetchAndUnblindUtxos(
        [
          {
            confidentialAddress: senderAddress.confidentialAddress,
            blindingPrivateKey: senderAddress.blindingPrivateKey,
          },
        ],
        APIURL
      );

      const faucetUtxo = senderUtxos.find(utxo => utxo.txid === txid);
      assert.deepStrictEqual(isBlindedUtxo(faucetUtxo!), false);
    });

    it('should skip unblinding step if the skip predicate returns true', async () => {
      const senderUtxos = await fetchAndUnblindUtxos(
        [
          {
            confidentialAddress: senderAddress.confidentialAddress,
            blindingPrivateKey: senderAddress.blindingPrivateKey,
          },
        ],
        APIURL,
        // with this skip predicate, `txid` utxos won't be unblinded
        (utxo: UtxoInterface) => utxo.txid === txid
      );

      const faucetUtxo = senderUtxos.find(utxo => utxo.txid === txid);
      assert.deepStrictEqual(isBlindedUtxo(faucetUtxo!), true);
    });

    it('should return an UtxoInterface with extra esplora enriched fields if the UtxoInterface interface as input contains extra esplora enriched fields', async () => {
      const senderUtxos = await fetchAndUnblindUtxos(
        [
          {
            confidentialAddress: senderAddress.confidentialAddress,
            blindingPrivateKey: senderAddress.blindingPrivateKey,
          },
        ],
        APIURL
      );
      const faucetUtxo = senderUtxos.find(utxo => utxo.txid === txid);
      const utxoInterface = await fetchPrevoutAndTryToUnblindUtxo(
        faucetUtxo as UtxoInterface,
        senderAddress.blindingPrivateKey,
        APIURL
      );
      expect(utxoInterface.unblindedUtxo).toMatchObject({
        asset: expect.any(String),
        assetcommitment: expect.any(String),
        noncecommitment: expect.any(String),
        prevout: {
          asset: expect.any(Buffer),
          nonce: expect.any(Buffer),
          rangeProof: expect.any(Buffer),
          script: expect.any(Buffer),
          surjectionProof: expect.any(Buffer),
          value: expect.any(Buffer),
        },
        status: {
          block_hash: expect.any(String),
          block_height: expect.any(Number),
          block_time: expect.any(Number),
          confirmed: expect.any(Boolean),
        },
        txid: expect.any(String),
        unblindData: {
          asset: expect.any(Buffer),
          assetBlindingFactor: expect.any(Buffer),
          value: '100000000',
          valueBlindingFactor: expect.any(Buffer),
        },
        value: 100000000,
        valuecommitment: expect.any(String),
        vout: expect.any(Number),
      });
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
        APIURL
      );

      const faucetTx = senderTxs.find(t => t.txid === txid);
      assert.notStrictEqual(faucetTx, undefined);
    });

    it('should skip transaction specified by skip function (and does not return it)', async () => {
      const senderTxs = await fetchAndUnblindTxs(
        [senderAddress.confidentialAddress],
        () => senderAddress.blindingPrivateKey,
        APIURL,
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
        APIURL
      );

      const faucetTx = senderTxs.find(t => t.txid === txid);
      assert.notStrictEqual(faucetTx, undefined);
    });
  });
});
