const axios = require('axios');
// Nigiri Chopstick Liquid base URI
export const APIURL = process.env.EXPLORER || `http://localhost:3001`;

export function sleep(ms: number): Promise<any> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function fetchUtxos(address: string, txid?: string): Promise<any> {
  let utxos: any = [];
  try {
    utxos = (await axios.get(`${APIURL}/address/${address}/utxo`)).data;
    if (txid) {
      utxos = utxos.filter((u: any) => u.txid === txid);
    }
  } catch (e) {
    console.error(e);
    throw e;
  }
  return utxos;
}

export async function faucet(address: string): Promise<void> {
  try {
    await axios.post(`${APIURL}/faucet`, { address });
    while (true) {
      try {
        const utxos = await fetchUtxos(address);
        if (utxos.length > 0) {
          return;
        }
        sleep(1000);
      } catch (ignore) {}
    }
  } catch (e) {
    console.error(e);
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
    const response = await axios.post(`${APIURL}/mint`, { address, quantity });
    while (true) {
      try {
        const utxos = await fetchUtxos(address);
        if (utxos.length > 0) {
          break;
        }
        sleep(1000);
      } catch (ignore) {}
    }
    return response.data;
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
