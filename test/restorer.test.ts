import { EsploraIdentityRestorer } from '../src/identity/identityRestorer';
import { faucet } from './_regtest';

import * as assert from 'assert';

jest.setTimeout(15000);

const addressToFaucet =
  'AzpqS7wVhDLhohSr3xmEWthdYBm9vtrzQeZ3TmjTLoCSCyJn6TjA1VMuDSLwdFeCRY7LVxPvwgDNJmGc';

const addressToNotFaucet =
  'AzpjnpWdDRSFnWC4Ymzwn3b8srTf7aLVRt5Ci13K5KpsUFkGTNQA6qHwxRNGDWH5gztp7wu3cEnZciY2';

const restorer = new EsploraIdentityRestorer('http://localhost:3001');

let resultThatShouldBeTrue: boolean;
let resultThatShouldBeFalse: boolean;

describe('EsploraIdentityRestorer', () => {
  describe('EsploraIdentityRestorer.addressHasBeenUsed', () => {
    beforeAll(async () => {
      await faucet(addressToFaucet);
      resultThatShouldBeTrue = await restorer.addressHasBeenUsed(
        addressToFaucet
      );
      resultThatShouldBeFalse = await restorer.addressHasBeenUsed(
        addressToNotFaucet
      );
    });

    it('should return true if the address has txs', () => {
      assert.deepStrictEqual(resultThatShouldBeTrue, true);
    });

    it('should return false if the address has no txs', () => {
      assert.deepStrictEqual(resultThatShouldBeFalse, false);
    });
  });
});
