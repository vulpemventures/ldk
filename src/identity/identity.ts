import { TinySecp256k1Interface as ecpairTinySecp256k1Interface } from 'ecpair';
import { TinySecp256k1Interface as slip77TinySecp256k1Interface } from 'slip77';
import { TinySecp256k1Interface as bip32TinySecp256k1Interface } from 'bip32';
import { Transaction, networks, TxOutput } from 'liquidjs-lib';
import { Network } from 'liquidjs-lib/src/networks';
import { BlindingDataLike, Psbt } from 'liquidjs-lib/src/psbt';
import {
  AddressInterface,
  BlindingKeyGetterAsync,
  NetworkString,
} from '../types';
import { IdentityType } from '../types';
import { isConfidentialOutput, psetToUnsignedHex, decodePset } from '../utils';
import secp256k1, { ZKP } from '@vulpemventures/secp256k1-zkp';
import { Confidential } from 'liquidjs-lib/src/confidential';

export type TinySecp256k1Interface = bip32TinySecp256k1Interface &
  slip77TinySecp256k1Interface &
  ecpairTinySecp256k1Interface;

/**
 * The identity interface.
 * @member network the network type (regtest, liquid...)
 * @member type the Identity type @see IdentityType
 * @method signPset take a base64 pset, sign it, and returns the result base64 encoded.
 * @method getAddresses returns all the generated addresses (and their blindkey if confidential).
 */
export interface IdentityInterface {
  network: Network;
  type: IdentityType;
  getNextAddress(
    constructorParams?: Record<string, string | number>
  ): Promise<AddressInterface>;
  getNextChangeAddress(
    constructorParams?: Record<string, string | number>
  ): Promise<AddressInterface>;
  signPset(psetBase64: string): Promise<string>;
  getAddresses(): Promise<AddressInterface[]>;
  getBlindingPrivateKey(script: string): Promise<string>;
  isAbleToSign(): boolean;
  blindPset(
    // the pset to blind
    psetBase64: string,
    // the output to blind, specifided by output index
    outputsIndexToBlind: number[],
    // optional: an outputs index to hex encoded blinding pub key
    // only useful for non-wallet outputs
    outputsPubKeysByIndex?: Map<number, string>,
    // BlindingDataLike to use to blind the outputs by input index
    inputsBlindingDataLike?: Map<number, BlindingDataLike>
  ): Promise<string>;
}

/**
 * Identity constructors options.
 * @member chain the blockchain type of the identity.
 * @member type the identity type @see IdentityType .
 * @member value the data used to create the Identity. depends of the type.
 */
export interface IdentityOpts<optsT> {
  chain: NetworkString;
  type: number;
  opts: optsT;
  ecclib: TinySecp256k1Interface;
  zkplib: ZKP;
}

/**
 * Abstract class for Identity.
 */
export class Identity {
  network: Network;
  type: IdentityType;
  ecclib: TinySecp256k1Interface;

  constructor(args: IdentityOpts<any>) {
    if (!args.chain || !networks.hasOwnProperty(args.chain)) {
      throw new Error('Network is missing or not valid');
    }

    if (!args.type || !(args.type in IdentityType)) {
      throw new Error('Type is missing or not valid');
    }

    this.network = (networks as Record<string, Network>)[args.chain];
    this.type = args.type;
    this.ecclib = args.ecclib;
  }

  async blindPsetWithBlindKeysGetter(
    getBlindingKeyPair: (
      script: Buffer
    ) => { publicKey: Buffer; privateKey: Buffer },
    psetBase64: string,
    outputsToBlind: number[],
    outputsPubKeys?: Map<number, string>,
    inputsBlindingDataLike?: Map<number, BlindingDataLike>
  ): Promise<string> {
    const inputsData = new Map<number, BlindingDataLike>();
    const outputsKeys = new Map<number, Buffer>();

    const pset = decodePset(psetBase64);
    const transaction = Transaction.fromHex(psetToUnsignedHex(psetBase64));

    // set the outputs map
    for (const index of outputsToBlind) {
      if (outputsPubKeys?.has(index)) {
        const pubKey = Buffer.from(outputsPubKeys.get(index)!, 'hex');
        outputsKeys.set(index, pubKey);
        continue;
      }

      const { script } = transaction.outs[index];
      const pubKey = getBlindingKeyPair(script).publicKey;
      outputsKeys.set(index, pubKey);
    }

    // set the inputs map
    for (let index = 0; index < pset.data.inputs.length; index++) {
      const input = pset.data.inputs[index];
      let script: Buffer | undefined = undefined;

      // continue if the input witness is unconfidential
      if (input.witnessUtxo) {
        if (!isConfidentialOutput(input.witnessUtxo)) {
          continue;
        }

        script = input.witnessUtxo.script;
      }

      if (input.nonWitnessUtxo) {
        const vout = transaction.ins[index].index;
        const witness = Transaction.fromBuffer(input.nonWitnessUtxo).outs[vout];
        if (!isConfidentialOutput(witness)) {
          continue;
        }

        script = witness.script;
      }

      // check if blindingDataLike is specified
      if (inputsBlindingDataLike?.has(index)) {
        inputsData.set(index, inputsBlindingDataLike.get(index));
        continue;
      }

      if (!script) {
        throw new Error('no witness script for input #' + index);
      }

      // else, get the private blinding key and use it as blindingDataLike
      const privKey = getBlindingKeyPair(script).privateKey;
      const zkpLib = await secp256k1();
      const confidential = new Confidential(zkpLib);
      const blinders = await confidential.unblindOutputWithKey(
        input.witnessUtxo as TxOutput,
        privKey
      );

      inputsData.set(index, blinders);
    }

    const blinded = await pset.blindOutputsByIndex(
      Psbt.ECCKeysGenerator(this.ecclib),
      inputsData,
      outputsKeys
    );

    return blinded.toBase64();
  }
}

export function privateBlindKeyGetter(
  identity: IdentityInterface
): BlindingKeyGetterAsync {
  return async (script: string) => {
    return identity.getBlindingPrivateKey(script);
  };
}
