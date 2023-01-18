import ECPairFactory from 'ecpair';
import { networks, payments } from 'liquidjs-lib';
import { Mnemonic } from '../../src/identity/mnemonic';
import * as ecc from 'tiny-secp256k1';
import secp256k1 from '@vulpemventures/secp256k1-zkp';

const ECPair = ECPairFactory(ecc);
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

export const newRandomMnemonic = async () => {
  const zkplib = await secp256k1();
  return Mnemonic.Random('regtest', ecc, zkplib);
};

// this is random address for who is receiving the withdrawal
export const recipientAddress = payments.p2wpkh({
  pubkey: keyPair2.publicKey,
  blindkey: blindKeyPair2.publicKey,
  network,
}).confidentialAddress!;
