import { UtxoInterface } from './../dist/types.d';
import { fetchAndUnblindUtxos } from '../src/explorer/esplora';
import { senderAddress, senderBlindingKey } from './fixtures/wallet.keys';
import { APIURL, faucet } from './_regtest';
import { isBlindedUtxo } from '../src/utils';
import * as assert from 'assert';

jest.setTimeout(50000);

describe('fetchAndUnblindUtxos', () => {
  let txid: string;

  beforeAll(async () => {
    txid = await faucet(senderAddress);
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
});
