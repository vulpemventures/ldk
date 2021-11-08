import * as assert from 'assert';
import { networks, address } from 'liquidjs-lib';

import { fetchAndUnblindTxsGenerator } from '../src/explorer/transaction';
import { fetchAndUnblindUtxosGenerator } from '../src/explorer/utxos';
import {
  AddressInterface,
  asset,
  isUnblindedOutput,
  Output,
  sats,
  TxInterface,
} from '../src/types';

import { APIURL, faucet } from './_regtest';
import { recipientAddress, newRandomMnemonic } from './fixtures/wallet.keys';

jest.setTimeout(500000);

describe('Wallet - Transaction builder', () => {
  let faucetTxID: string;
  let senderAddress: AddressInterface;

  beforeAll(async () => {
    const sender = newRandomMnemonic();
    senderAddress = await sender.getNextAddress();
    faucetTxID = await faucet(senderAddress.confidentialAddress);
  });

  describe('FetchAndUnblindTx function', () => {
    let faucetTx: TxInterface;

    beforeAll(async () => {
      const txs = fetchAndUnblindTxsGenerator(
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

      for await (const tx of txs) {
        if (tx.txid === faucetTxID) {
          faucetTx = tx;
        }
      }
    });

    it('should fetch all the transactions of an address & unblind the outputs', async () => {
      const LBTC = networks.regtest.assetHash;
      const hasOutputWithValue1LBTC = faucetTx!.vout.some(out => {
        if (isUnblindedOutput(out)) {
          return sats(out) === 1_0000_0000 && asset(out) === LBTC;
        }
        return false;
      });

      expect(hasOutputWithValue1LBTC).toEqual(true);
    });

    it('should fetch all the transactions of an address & unblind the prevouts', async () => {
      const txs = fetchAndUnblindTxsGenerator(
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
      let faucetTx = (await txs.next()).value as TxInterface;
      while (faucetTx.txid !== faucetTxID) {
        faucetTx = (await txs.next()).value as TxInterface;
      }

      const hasUnblindedPrevout = faucetTx!.vout.some(prevout => {
        if (isUnblindedOutput(prevout)) {
          return (
            sats(prevout) === 1_0000_0000 &&
            asset(prevout) === networks.regtest.assetHash
          );
        }
        return false;
      });
      expect(hasUnblindedPrevout).toEqual(true);
    });
  });

  describe('fetchAndUnblindUtxosGenerator function', () => {
    it('should return utxos at each next iteration', async () => {
      const utxosGenerator = fetchAndUnblindUtxosGenerator(
        [
          {
            confidentialAddress: senderAddress.confidentialAddress,
            blindingPrivateKey: senderAddress.blindingPrivateKey,
          },
          {
            confidentialAddress: recipientAddress,
            blindingPrivateKey: '',
          },
        ],
        APIURL
      );

      const utxosArray: Output[] = [];
      let utxoV = await utxosGenerator.next();
      while (!utxoV.done) {
        if (utxoV.done === false) {
          utxosArray.push(utxoV.value);
          utxoV = await utxosGenerator.next();
        }
      }

      assert.strictEqual(utxosArray.length, utxoV.value.numberOfUtxos);
      assert.strictEqual(utxoV.value.errors.filter(e => e).length, 0);
    });
  });

  describe('fetchAndUnblindTxsGenerator function', () => {
    it('should return tx at each next iteration', async () => {
      const txsGenerator = fetchAndUnblindTxsGenerator(
        [senderAddress.confidentialAddress],
        () => senderAddress.blindingPrivateKey,
        APIURL
      );

      let tx = await txsGenerator.next();
      while (!tx.done) {
        tx = await txsGenerator.next();
      }
      assert.strictEqual(tx.done, true);
    });
  });
});
