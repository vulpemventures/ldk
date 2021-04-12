import { networks, address } from 'liquidjs-lib';
import { APIURL, faucet } from './_regtest';
import * as assert from 'assert';
import { recipientAddress, sender } from './fixtures/wallet.keys';
import {
  AddressInterface,
  isBlindedOutputInterface,
  TxInterface,
  UnblindedOutputInterface,
  UtxoInterface,
} from '../src/types';
import { fetchAndUnblindTxsGenerator } from '../src/explorer/transaction';
import { fetchAndUnblindUtxosGenerator } from '../src/explorer/utxos';

jest.setTimeout(500000);

describe('Wallet - Transaction builder', () => {
  let faucetTxID: string;
  let senderAddress: AddressInterface;

  beforeAll(async () => {
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

      const utxosArray: UtxoInterface[] = [];
      let utxoV = await utxosGenerator.next();
      while (!utxoV.done) {
        utxosArray.push(utxoV.value as UtxoInterface);
        utxoV = await utxosGenerator.next();
      }

      assert.strictEqual(utxosArray.length, utxoV.value.numberOfUtxos);
      assert.strictEqual(utxoV.value.errors.length, 0);
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
