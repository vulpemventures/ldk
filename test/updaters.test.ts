import axios, { AxiosError, AxiosInstance } from 'axios';
import {
  ElectrsBatchServer,
  fetchAllUtxos,
  IdentityType,
  Mnemonic,
  mnemonicRestorerFromChain,
  privateBlindKeyGetter,
} from '../src';
import * as ecc from 'tiny-secp256k1';

jest.setTimeout(100000);

describe('Electrs', () => {
  it.skip('should fetch on mainnet using ElectrsBatchServer', async () => {
    const id = new Mnemonic({
      chain: 'liquid',
      ecclib: ecc,
      type: IdentityType.Mnemonic,
      opts: {
        mnemonic: '',
      },
    });

    const api = new ElectrsBatchServer(
      'https://electrs-batch-server.vulpem.com',
      'https://blockstream.info/liquid/api',
      makeRetryAxios({ maxRetryTime: 2, retryOnCodes: [500, 503] })
    );
    const restored = await mnemonicRestorerFromChain(id)({ api, gapLimit: 50 });
    const addresses = await restored.getAddresses();
    const addressesStr = addresses.map(a => a.confidentialAddress);
    console.log(addressesStr.length);
    console.time('utxos');
    const utxos = await fetchAllUtxos(
      addressesStr,
      privateBlindKeyGetter(restored),
      api
    );
    console.timeEnd('utxos');

    console.time('txs');
    const txs = await api.fetchTxs(addressesStr);
    console.timeEnd('txs');
    console.log(utxos.length, txs.length);
  });
});

const makeRetryAxios = (options: {
  maxRetryTime: number;
  retryOnCodes: Array<number>;
}): AxiosInstance => {
  const instance = axios.create();
  let counter = 0;
  instance.interceptors.response.use(undefined, (error: AxiosError) => {
    const config = error.config;
    // you could defined status you want to retry, such as 503
    // if (counter < max_time && error.response.status === retry_status_code) {
    if (
      counter < options.maxRetryTime &&
      error.response &&
      options.retryOnCodes.includes(error.response.status)
    ) {
      counter++;
      return new Promise(resolve => {
        resolve(instance(config));
      });
    }
    return Promise.reject(error);
  });
  return instance;
};
