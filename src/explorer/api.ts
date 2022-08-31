import axios, { AxiosInstance } from 'axios';
import { Transaction, TxOutput } from 'liquidjs-lib';
import { InputInterface, Outpoint, Output, TxInterface } from '../types';
import { EsploraTx, EsploraUtxo } from './types';

export interface ChainAPI {
  fetchUtxos(
    addresses: string[],
    skip?: (utxo: EsploraUtxo) => boolean
  ): Promise<Output[]>;
  fetchTxs(
    addresses: string[],
    skip?: (esploraTx: EsploraTx) => boolean
  ): Promise<TxInterface[]>;
  fetchTxsHex(txids: string[]): Promise<{ txid: string; hex: string }[]>;
  addressesHasBeenUsed(addresses: string[]): Promise<boolean[]>;
}

/**
 * Esplora is the ChainAPI implmentation for regular esplora instance
 * Esplora also exports extra methods specific to esplora instance
 */
export class Electrs implements ChainAPI {
  readonly electrsURL: string;
  readonly axios: AxiosInstance;

  constructor(url: string, axiosIns?: AxiosInstance) {
    this.electrsURL = url;
    this.axios = axiosIns ?? axios.create();
  }

  static fromURL(url: string): Electrs {
    return new Electrs(url);
  }

  async addressesHasBeenUsed(addresses: string[]): Promise<boolean[]> {
    const hasBeenUsed = async (address: string) => {
      try {
        const data = (
          await axios.get(`${this.electrsURL}/address/${address}/txs`)
        ).data;
        return data.length > 0;
      } catch (e) {
        return false;
      }
    };
    return Promise.all(addresses.map(hasBeenUsed));
  }

  async fetchUtxos(
    addresses: string[],
    skip?: (utxo: EsploraUtxo) => boolean
  ): Promise<Output[]> {
    const reqs = addresses.map(address =>
      this.axios.get(`${this.electrsURL}/address/${address}/utxo`)
    );
    const responses = await Promise.allSettled(reqs);
    const resolvedResponses = responses.map(r =>
      r.status === 'fulfilled' ? r.value.data : []
    );
    const utxos = resolvedResponses.map(r => (r ? r : []));
    return Promise.all(
      utxos
        .flat()
        .filter((u: EsploraUtxo) => (skip ? !skip(u) : true))
        .map(this.outpointToUtxo())
    );
  }

  async fetchTxs(
    addresses: string[],
    skip?: (tx: EsploraTx) => boolean
  ): Promise<TxInterface[]> {
    const esploraTxs = await Promise.all(
      addresses.map(this.fetchAllTxsForAddress())
    );
    const txs = esploraTxs
      .flat()
      .filter((tx: EsploraTx) => (skip ? !skip(tx) : true))
      .map(esploraTxToTxInterface(ids => this.fetchTxsHex(ids)));
    return Promise.all(txs);
  }

  async fetchTxHex(txid: string): Promise<string> {
    const h = (await this.axios.get(`${this.electrsURL}/tx/${txid}/hex`)).data;
    return h;
  }

  async fetchTxsHex(txids: string[]): Promise<{ txid: string; hex: string }[]> {
    return Promise.all(
      txids.map(async txid => ({ txid, hex: await this.fetchTxHex(txid) }))
    );
  }

  async fetchTx(txid: string): Promise<TxInterface> {
    return esploraTxToTxInterface(ids => this.fetchTxsHex(ids))(
      (await this.axios.get(`${this.electrsURL}/tx/${txid}`)).data
    );
  }

  private fetchAllTxsForAddress() {
    return async (address: string): Promise<EsploraTx[]> => {
      let lastSeenTxid = undefined;
      const txs = [];
      do {
        // fetch up to 25 txs
        const nextTxs: EsploraTx[] = await this.fetch25newestTxsForAddress(
          address,
          lastSeenTxid
        );

        if (nextTxs.length === 0) break;
        txs.push(...nextTxs);
        if (nextTxs.length < 25) break;
        lastSeenTxid = nextTxs[nextTxs.length - 1].txid;
      } while (lastSeenTxid);
      return txs;
    };
  }

  private async fetch25newestTxsForAddress(
    address: string,
    lastSeenTxid?: string
  ): Promise<EsploraTx[]> {
    let url = `${this.electrsURL}/address/${address}/txs/chain`;
    if (lastSeenTxid) {
      url += `/${lastSeenTxid}`;
    }

    const response = await this.axios.get(url);
    return response.data;
  }

  protected outpointToUtxo() {
    return async (outpoint: Outpoint): Promise<Output> => {
      const prevoutHex = await this.fetchTxHex(outpoint.txid);
      const prevout = Transaction.fromHex(prevoutHex).outs[outpoint.vout];
      return { ...outpoint, prevout };
    };
  }
}

// https://electrs-batch-server.vulpem.com/
export class ElectrsBatchServer extends Electrs implements ChainAPI {
  constructor(
    readonly batchServerURL: string,
    readonly electrsURL: string,
    axiosIns?: AxiosInstance
  ) {
    super(electrsURL, axiosIns);
  }

  static fromURL(_: string): ElectrsBatchServer {
    throw new Error(
      'Not implemented: use Electrs.fromURL or ElectrsBatchServer.fromURLs instead'
    );
  }

  static fromURLs(url: string, electrsUrl: string): ElectrsBatchServer {
    return new ElectrsBatchServer(url, electrsUrl);
  }

  async addressesHasBeenUsed(addresses: string[]): Promise<boolean[]> {
    const response = await this.axios.post(
      `${this.batchServerURL}/addresses/transactions`,
      { addresses }
    );
    const results = [];
    for (const { transaction } of response.data) {
      results.push(transaction.length > 0);
    }
    return results;
  }

  async fetchUtxos(
    addresses: string[],
    skip?: (utxo: EsploraUtxo) => boolean
  ): Promise<Output[]> {
    const response = await this.axios.post(
      `${this.batchServerURL}/addresses/utxo`,
      { addresses }
    );
    if (response.status !== 200) {
      throw new Error(`Error fetching utxos: ${response.status}`);
    }

    if (!response.data || !Array.isArray(response.data)) {
      throw new Error('Invalid response from batch server');
    }

    const utxos = [];
    for (const { utxo } of response.data) {
      if (!Array.isArray(utxo)) continue;
      if (utxo.length === 0) continue;
      utxos.push(...utxo);
    }

    return await Promise.all(
      utxos
        .filter((u: EsploraUtxo) => (skip ? !skip(u) : true))
        .map(super.outpointToUtxo())
    );
  }

  async fetchTxsHex(txids: string[]): Promise<{ txid: string; hex: string }[]> {
    const response = await this.axios.post(
      `${this.batchServerURL}/transactions/hex`,
      { txids }
    );
    return response.data || [];
  }

  async fetchTxs(
    addresses: string[],
    skip?: (tx: EsploraTx) => boolean
  ): Promise<TxInterface[]> {
    const response = await this.axios.post(
      `${this.batchServerURL}/addresses/transactions`,
      { addresses }
    );
    const promises = [];

    for (const { transaction } of response.data) {
      if (transaction.length === 0) continue;
      promises.push(
        ...transaction
          .filter((tx: EsploraTx) => (skip ? !skip(tx) : true))
          .map(esploraTxToTxInterface(ids => this.fetchTxsHex(ids)))
      );
    }
    return Promise.all(promises);
  }
}

// util function for output mapping
function makeOutput(outpoint: Outpoint, txOutput: TxOutput): Output {
  return {
    ...outpoint,
    prevout: txOutput,
  };
}

function esploraTxToTxInterface(
  fetchTxFn: (txIDs: string[]) => Promise<{ txid: string; hex: string }[]>
) {
  return async (esploraTx: EsploraTx): Promise<TxInterface> => {
    // make an unique call to the api to fetch all the transaction needed
    // prevouts transactions (except pegin) + the current transaction
    const transactions = await fetchTxFn([
      ...esploraTx.vin.filter(input => !input.is_pegin).map(i => i.txid),
      esploraTx.txid,
    ]);

    const makePrevout = ({ txid, vout }: Outpoint): Output => {
      const hex = transactions?.find(t => t.txid === txid);
      if (!hex) throw new Error(`Could not find tx ${txid}`);
      const prevout = Transaction.fromHex(hex.hex).outs[vout];
      return makeOutput({ txid, vout }, prevout);
    };

    const txInputs: InputInterface[] = esploraTx.vin.map(input => ({
      prevout: input.is_pegin ? undefined : makePrevout(input),
      txid: input.txid,
      vout: input.vout,
      isPegin: input.is_pegin,
    }));

    const txHex = transactions?.find(t => t.txid === esploraTx.txid)?.hex;
    if (!txHex) throw new Error(`Could not find tx ${esploraTx.txid}`);
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
  };
}
