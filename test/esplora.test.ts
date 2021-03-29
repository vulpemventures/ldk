import { UtxoInterface } from './../dist/types.d';
import * as assert from 'assert';
import {
  fetchAndUnblindTxs,
  fetchAndUnblindUtxos,
  fetchPrevoutAndTryToUnblindUtxo,
  isBlindedUtxo,
} from '../src';
import {
  senderAddress,
  senderBlindingKey,
  senderBlindKeyGetter,
  unconfidentialSenderAddress,
} from './fixtures/wallet.keys';
import { APIURL, faucet } from './_regtest';

jest.setTimeout(80000);

describe('esplora', () => {
  let txid: string;

  beforeAll(async () => {
    txid = await faucet(senderAddress);
    await faucet(unconfidentialSenderAddress);
  });

  describe('fetchAndUnblindUtxos', () => {
    it('should fetch the utxo prevout, even if unconfidential address is provided', async () => {
      const senderUtxos = await fetchAndUnblindUtxos(
        [
          {
            confidentialAddress: senderAddress,
            blindingPrivateKey: senderBlindingKey,
          },
        ],
        APIURL
      );

      const withPrevouts = senderUtxos.filter(u => u.prevout);
      assert.deepStrictEqual(withPrevouts.length, senderUtxos.length);
    });

    it('should unblind utxos if the blinding key is provided', async () => {
      const senderUtxos = await fetchAndUnblindUtxos(
        [
          {
            confidentialAddress: senderAddress,
            blindingPrivateKey: senderBlindingKey,
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
            confidentialAddress: senderAddress,
            blindingPrivateKey: senderBlindingKey,
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
            confidentialAddress: senderAddress,
            blindingPrivateKey: senderBlindingKey,
          },
        ],
        APIURL
      );
      const faucetUtxo = senderUtxos.find(utxo => utxo.txid === txid);
      const utxoInterface = await fetchPrevoutAndTryToUnblindUtxo(
        faucetUtxo as UtxoInterface,
        senderBlindingKey,
        APIURL
      );
      expect(utxoInterface).toMatchObject({
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
        [senderAddress],
        senderBlindKeyGetter,
        APIURL
      );

      const faucetTx = senderTxs.find(t => t.txid === txid);
      assert.notStrictEqual(faucetTx, undefined);
    });

    it('should skip transaction specified by skip function (and does not return it)', async () => {
      const senderTxs = await fetchAndUnblindTxs(
        [senderAddress],
        senderBlindKeyGetter,
        APIURL,
        tx => tx.txid === txid
      );

      const faucetTx = senderTxs.find(t => t.txid === txid);
      assert.strictEqual(faucetTx, undefined);
    });

    it('should work with duplicate addresses', async () => {
      const senderTxs = await fetchAndUnblindTxs(
        [senderAddress, senderAddress],
        senderBlindKeyGetter,
        APIURL
      );

      const faucetTx = senderTxs.find(t => t.txid === txid);
      assert.notStrictEqual(faucetTx, undefined);
    });
  });
});
