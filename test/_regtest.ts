const axios = require('axios');
// Nigiri Chopstick Liquid base URI
export const APIURL = process.env.EXPLORER || `http://localhost:3001`;

export function sleep(ms: number): Promise<any> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function fetchUtxos(
  address: string,
  txid?: string
): Promise<any[]> {
  try {
    let utxos = (await axios.get(`${APIURL}/address/${address}/utxo`)).data;
    if (txid) {
      utxos = utxos.filter((u: any) => u.txid === txid);
    }
    return utxos;
  } catch (e) {
    console.error(e);
    throw e;
  }
}

export async function faucet(address: string): Promise<string> {
  try {
    const { status, data } = await axios.post(`${APIURL}/faucet`, { address });
    if (status !== 200) {
      throw new Error('Invalid address');
    }
    const { txId } = data;

    while (true) {
      sleep(1000);
      try {
        const utxos = await fetchUtxos(address, txId);
        if (utxos.length > 0) {
          return txId;
        }
      } catch (ignore) {}
    }
  } catch (e) {
    throw e;
  }
}

export async function fetchTxHex(txId: string): Promise<string> {
  try {
    return (await axios.get(`${APIURL}/tx/${txId}/hex`)).data;
  } catch (e) {
    console.error(e);
    throw e;
  }
}

export async function mint(
  address: string,
  quantity: number
): Promise<{ asset: string; txid: string }> {
  try {
    const { status, data } = await axios.post(`${APIURL}/mint`, {
      address,
      quantity,
    });
    if (status !== 200) {
      throw new Error('Invalid address');
    }

    while (true) {
      sleep(1000);
      try {
        const utxos = await fetchUtxos(address, data.txId);
        if (utxos.length > 0) {
          return data;
        }
      } catch (ignore) {}
    }
  } catch (e) {
    console.error(e);
    throw e;
  }
}

export async function broadcastTx(hex: string): Promise<string> {
  try {
    return (await axios.post(`${APIURL}/tx`, hex)).data;
  } catch (err) {
    console.error(err);
    throw err;
  }
}
