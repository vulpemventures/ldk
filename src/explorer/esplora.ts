import axios, { AxiosError, AxiosInstance } from 'axios';
import { Transaction, TxOutput } from 'liquidjs-lib';
import {
  TxInterface,
  InputInterface,
  Output,
  Outpoint,
  isUnblindedOutput,
  getSats,
  getAsset,
} from '../types';
import { EsploraTx, EsploraUtxo } from './types';

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

export const axiosInstance = makeRetryAxios({
  maxRetryTime: 3,
  retryOnCodes: [500, 502, 503, 504],
});

/**
 * Fetch the raw transaction by txid
 * @param txId txID to fetch
 * @param url esplora URL
 */
export async function fetchTxHex(txId: string, url: string): Promise<string> {
  return (await axiosInstance.get(`${url}/tx/${txId}/hex`)).data;
}

/**
 * Fetch the transaction as TxInterface (with prevouts)
 * @param txId transaction's hash to fetch
 * @param url the esplora URL
 */
export async function fetchTx(txId: string, url: string): Promise<TxInterface> {
  return esploraTxToTxInterface(
    (await axiosInstance.get(`${url}/tx/${txId}`)).data,
    url
  );
}

/**
 * Fetch unspents for a given address.
 * @param address
 * @param url the esplora URL
 */
export async function fetchUtxos(
  address: string,
  url: string
): Promise<Output[]> {
  const esploraUtxos: EsploraUtxo[] = (
    await axiosInstance.get(`${url}/address/${address}/utxo`)
  ).data;
  return Promise.all(esploraUtxos.map(outpointToUtxo(url)));
}

const outpointToUtxo = (esploraURL: string) => async (
  outpoint: Outpoint
): Promise<Output> => {
  const prevoutHex: string = await fetchTxHex(outpoint.txid, esploraURL);
  const prevout = Transaction.fromHex(prevoutHex).outs[outpoint.vout];
  return { ...outpoint, prevout };
};

/**
 * Convert an esplora transaction to a TxInterface
 * @param esploraTx
 * @param explorerUrl
 */
export async function esploraTxToTxInterface(
  esploraTx: EsploraTx,
  explorerUrl: string
): Promise<TxInterface> {
  const inputTxIds: string[] = [];
  const inputVouts: number[] = [];

  for (const input of esploraTx.vin) {
    inputTxIds.push(input.txid);
    inputVouts.push(input.vout);
  }

  const prevoutTxHexs = await Promise.all(
    inputTxIds.map((txid, index) => {
      if (!esploraTx.vin[index].is_pegin) return fetchTxHex(txid, explorerUrl);
      return Promise.resolve(undefined); // return undefined in case of pegin
    })
  );

  const prevoutAsOutput = prevoutTxHexs.map(
    (hex: string | undefined, index: number) => {
      if (!hex) return undefined;
      return makeOutput(
        { txid: inputTxIds[index], vout: inputVouts[index] },
        Transaction.fromHex(hex).outs[inputVouts[index]]
      );
    }
  );

  const txInputs: InputInterface[] = inputTxIds.map(
    (txid: string, index: number) => {
      return {
        prevout: prevoutAsOutput[index],
        txid: txid,
        vout: inputVouts[index],
        isPegin: esploraTx.vin[index].is_pegin,
      };
    }
  );

  const txHex = await fetchTxHex(esploraTx.txid, explorerUrl);
  const transaction = Transaction.fromHex(txHex);

  const makeOutpoint = (index: number): Outpoint => ({
    txid: esploraTx.txid,
    vout: index,
  });
  const makeOutputFromTxout = (txout: TxOutput, index: number): Output =>
    makeOutput(makeOutpoint(index), txout);
  const txOutputs = transaction.outs.map(makeOutputFromTxout);

  const tx: TxInterface = {
    txid: esploraTx.txid,
    vin: txInputs,
    vout: txOutputs,
    fee: esploraTx.fee,
    status: {
      confirmed: esploraTx.status.confirmed,
      blockHash: esploraTx.status.block_hash,
      blockHeight: esploraTx.status.block_height,
      blockTime: esploraTx.status.block_time,
    },
  };

  return tx;
}

// util function for output mapping
function makeOutput(outpoint: Outpoint, txOutput: TxOutput): Output {
  return {
    ...outpoint,
    prevout: txOutput,
  };
}

/**
 * Create unblinded explorer URL from blinding data
 * @param baseURL
 * @param txID
 * @param outputsBlinder
 */
export function makeUnblindURL(
  baseURL: string,
  txID: string,
  outputsBlinder: {
    value: number;
    asset: string;
    assetBlinder: string;
    valueBlinder: string;
  }[]
): string {
  const outputsString = outputsBlinder
    .map(
      ({ value, asset, assetBlinder, valueBlinder }) =>
        `${value},${asset},${valueBlinder},${assetBlinder}`
    )
    .join(',');
  return `${baseURL}/tx/${txID}#blinded=${outputsString}`;
}

/**
 * Create explorer URL with unblinding data
 * @param tx transaction to create the link for
 * @param baseURL base web Explorer URL
 */
export function getUnblindURLFromTx(tx: TxInterface, baseURL: string) {
  const outputsData: {
    value: number;
    asset: string;
    assetBlinder: string;
    valueBlinder: string;
  }[] = [];

  const reverseHex = (blinder: string) =>
    Buffer.from(blinder, 'hex')
      .reverse()
      .toString('hex');

  for (const output of tx.vout) {
    if (output.prevout.script.length > 0 && isUnblindedOutput(output)) {
      outputsData.push({
        value: getSats(output),
        asset: getAsset(output),
        assetBlinder: reverseHex(
          output.unblindData.assetBlindingFactor.toString('hex')
        ),
        valueBlinder: reverseHex(
          output.unblindData.valueBlindingFactor.toString('hex')
        ),
      });
    }
  }

  return makeUnblindURL(baseURL, tx.txid, outputsData);
}
