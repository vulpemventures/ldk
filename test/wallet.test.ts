import {
  isBlindedOutputInterface,
  fetchAndUnblindUtxosGenerator,
  fetchAndUnblindTxsGenerator,
} from '../src/wallet';
import { networks } from 'liquidjs-lib';
import { APIURL, sleep } from './_regtest';
import * as assert from 'assert';
import {
  senderAddress,
  recipientAddress,
  sender,
  senderBlindKeyGetter,
} from './fixtures/wallet.keys';
import axios from 'axios';
import {
  TxInterface,
  UnblindedOutputInterface,
  UtxoInterface,
} from '../src/types';

jest.setTimeout(500000);

describe('Wallet - Transaction builder', () => {
  let faucetTxID: string;

  beforeAll(async () => {
    const { txId } = (
      await axios.post(`${APIURL}/faucet`, { address: senderAddress })
    ).data;

    faucetTxID = txId;

    // sleep 5s for nigiri
    await sleep(5000);
  });

  describe('FetchAndUnblindTx function', () => {
    let faucetTx: TxInterface;

    beforeAll(async () => {
      const txs = await fetchAndUnblindTxsGenerator(
        [senderAddress],
        senderBlindKeyGetter,
        APIURL
      );

      faucetTx = (await txs.next()).value as TxInterface;
      while (faucetTx.txid !== faucetTxID) {
        faucetTx = (await txs.next()).value as TxInterface;
      }
    });

    it('should fetch all the transactions of an address & unblind the outputs', async () => {
      const LBTC = networks.regtest.assetHash;
      const hasOutputWithValue1LBTC = faucetTx!.vout.some(out => {
        if (!isBlindedOutputInterface(out)) {
          const unblindOutput = out as UnblindedOutputInterface;
          return (
            unblindOutput.value === 1_0000_0000 && unblindOutput.asset === LBTC
          );
        }
        return false;
      });

      expect(hasOutputWithValue1LBTC).toEqual(true);
    });

    it('should fetch all the transactions of an address & unblind the prevouts', async () => {
      const txs = await fetchAndUnblindTxsGenerator(
        [senderAddress],
        senderBlindKeyGetter,
        APIURL
      );

      let faucetTx = (await txs.next()).value as TxInterface;
      while (faucetTx.txid !== faucetTxID) {
        faucetTx = (await txs.next()).value as TxInterface;
      }

      const hasUnblindedPrevout = faucetTx!.vout.some(prevout => {
        if (!isBlindedOutputInterface(prevout)) {
          const unblindOutput = prevout as UnblindedOutputInterface;
          return (
            unblindOutput.value === 1_0000_0000 &&
            unblindOutput.asset === networks.regtest.assetHash
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
            address: senderAddress,
            blindingKey: sender.getNextAddress().blindingPrivateKey,
          },
          {
            address: recipientAddress,
            blindingKey: '',
          },
        ],
        APIURL
      );

      const utxosArray: UtxoInterface[] = [];
      let utxoV = await utxosGenerator.next();
      while (!utxoV.done) {
        utxosArray.push(utxoV.value as UtxoInterface);
        utxoV = await utxosGenerator.next();
      }

      assert.strictEqual(utxosArray.length, utxoV.value);
    });
  });

  describe('fetchAndUnblindTxsGenerator function', () => {
    it('should return tx at each next iteration', async () => {
      const txsGenerator = fetchAndUnblindTxsGenerator(
        [senderAddress],
        senderBlindKeyGetter,
        APIURL
      );

      const firstTxIt = await txsGenerator.next();
      assert.strictEqual(firstTxIt.done, false);
    });
  });
});
