import { networks, payments, ECPair } from 'liquidjs-lib';

import { PrivateKey } from '../../src/identity/privatekey';
import { IdentityType } from '../../src/types';

const network = networks.regtest;
// generate a random keyPair for bob
const keyPair2 = ECPair.fromWIF(
  'cSv4PQtTpvYKHjfp9qih2RMeieBQAVADqc8JGXPvA7mkJ8yD5QC1',
  network
);
// generate a random blinding keyPair for bob.
const blindKeyPair2 = ECPair.fromWIF(
  'cVcDj9Td96x8jcG1eudxKL6hdwziCTgvPhqBoazkDeFGSAR8pCG8',
  network
);

export const sender = new PrivateKey({
  chain: 'regtest',
  type: IdentityType.PrivateKey,
  opts: {
    signingKeyWIF: 'cPNMJD4VyFnQjGbGs3kcydRzAbDCXrLAbvH6wTCqs88qg1SkZT3J',
    blindingKeyWIF: 'cRdrvnPMLV7CsEak2pGrgG4MY7S3XN1vjtcgfemCrF7KJRPeGgW6',
  },
});

// this is random address for who is receiving the withdrawal
export const recipientAddress = payments.p2wpkh({
  pubkey: keyPair2.publicKey,
  blindkey: blindKeyPair2.publicKey,
  network,
}).confidentialAddress!;
