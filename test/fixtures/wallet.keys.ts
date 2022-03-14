import { networks, payments } from 'liquidjs-lib';
import { Mnemonic } from '../../src/identity/mnemonic';
import { ECPair } from '../../src/ecpair';

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

export const newRandomMnemonic = () => Mnemonic.Random('regtest');

// this is random address for who is receiving the withdrawal
export const recipientAddress = payments.p2wpkh({
  pubkey: keyPair2.publicKey,
  blindkey: blindKeyPair2.publicKey,
  network,
}).confidentialAddress!;
