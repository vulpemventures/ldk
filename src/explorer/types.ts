// Esplora tx format
export interface EsploraTx {
  txid: string;
  version: number;
  locktime: number;
  size: number;
  weight: number;
  fee: number;
  status: {
    confirmed: boolean;
    block_height: number;
    block_hash: string;
    block_time: number;
  };
  vin: Array<{
    txid: string;
    vout: number;
    scriptsig: string;
    witness: string[];
    is_coinbase: boolean;
    sequence: number;
    is_pegin: boolean;
  }>;
  vout: Array<{
    scriptpubkey: string;
    scriptpubkey_type: string;
    valuecommitment: string;
    assetcommitment: string;
  }>;
}
