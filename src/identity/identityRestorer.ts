import axios from 'axios';

export interface IdentityRestorerInterface {
  addressHasBeenUsed(address: string): Promise<boolean>;
  addressesHaveBeenUsed(addresses: string[]): Promise<boolean[]>;
}

/**
 * Implementation of IdentityRestorerInterface using Esplora endpoint.
 */
export class EsploraIdentityRestorer implements IdentityRestorerInterface {
  static DEFAULT_ESPLORA_ENDPOINT: string =
    'https://blockstream.info/liquid/api';

  private esploraEndpoint: string =
    EsploraIdentityRestorer.DEFAULT_ESPLORA_ENDPOINT;

  constructor(endpoint?: string) {
    if (endpoint) {
      this.esploraEndpoint = endpoint;
    }
  }

  // Use axios.all safer than Promise.all
  addressesHaveBeenUsed = async (addresses: string[]) => {
    return axios.all(addresses.map(this.addressHasBeenUsed));
  };

  // returns true if the address has txs according to esplora endpoint.
  addressHasBeenUsed = async (address: string) => {
    return axios
      .get(`${this.esploraEndpoint}/address/${address}/txs`)
      .then(
        // resolve
        ({ data }) => (data.length > 0 ? true : false),
        // reject
        _ => false
      )
      .catch(() => false);
  };
}
