import {
  Network,
  Psbt,
  Transaction,
  confidential,
  networks,
  TxOutput,
} from 'liquidjs-lib';
import {
  AddressInterface,
  BlindedOutputInterface,
  Outpoint,
  UnblindedOutputInterface,
  UtxoInterface,
} from './types';
// @ts-ignore
import b58 from 'bs58check';
import { fromBase58 } from 'bip32';
import { fromMasterBlindingKey } from 'slip77';
import { IdentityType } from '.';

export function toAssetHash(x: Buffer): string {
  const withoutFirstByte = x.slice(1);
  return (withoutFirstByte.reverse() as Buffer).toString('hex');
}

export function fromAssetHash(x: string): Buffer {
  return Buffer.concat([
    Buffer.from('01', 'hex'), //prefix for unconfidential asset
    Buffer.from(x, 'hex').reverse(),
  ]);
}

export function toNumber(x: Buffer): number {
  return confidential.confidentialValueToSatoshi(x);
}

export function isValidAmount(amount: number): boolean {
  if (amount <= 0 || !Number.isSafeInteger(amount)) return false;
  return true;
}

/**
 * The unblind output function's result interface.
 */
export interface UnblindResult {
  asset: Buffer;
  // in satoshis
  value: number;
}

const emptyNonce: Buffer = Buffer.from('0x00', 'hex');

function bufferNotEmptyOrNull(buffer?: Buffer): boolean {
  return buffer != null && buffer.length > 0;
}

/**
 * Checks if a given output is a confidential one.
 * @param output the ouput to check.
 */
export function isConfidentialOutput({
  rangeProof,
  surjectionProof,
  nonce,
}: any): boolean {
  return (
    bufferNotEmptyOrNull(rangeProof) &&
    bufferNotEmptyOrNull(surjectionProof) &&
    nonce !== emptyNonce
  );
}

export class BufferMap<T> {
  private map: Map<string, T>;

  constructor() {
    this.map = new Map<string, T>();
  }

  private bufferToStringPrimitive(buffer: Buffer): string {
    return buffer.toString('hex').valueOf();
  }

  get(key: Buffer): T | undefined {
    return this.map.get(this.bufferToStringPrimitive(key));
  }

  set(key: Buffer, value: T): this {
    this.map.set(this.bufferToStringPrimitive(key), value);
    return this;
  }

  values(): Array<T> {
    return Array.from(this.map.values());
  }
}

// This has been taken from https://github.com/Casa/xpub-converter/blob/master/js/xpubConvert.js
/*
  This script uses version bytes as described in SLIP-132
  https://github.com/satoshilabs/slips/blob/master/slip-0132.md
*/
const prefixes = new Map([
  ['xpub', '0488b21e'],
  ['ypub', '049d7cb2'],
  ['Ypub', '0295b43f'],
  ['zpub', '04b24746'],
  ['Zpub', '02aa7ed3'],
  ['tpub', '043587cf'],
  ['upub', '044a5262'],
  ['Upub', '024289ef'],
  ['vpub', '045f1cf6'],
  ['Vpub', '02575483'],
]);

/*
 * This function takes an extended public key (with any version bytes, it doesn't need to be an xpub)
 * and converts it to an extended public key formatted with the desired version bytes
 * @param xpub: an extended public key in base58 format. Example: xpub6CpihtY9HVc1jNJWCiXnRbpXm5BgVNKqZMsM4XqpDcQigJr6AHNwaForLZ3kkisDcRoaXSUms6DJNhxFtQGeZfWAQWCZQe1esNetx5Wqe4M
 * @param targetFormat: a string representing the desired prefix; must exist in the "prefixes" mapping defined above. Example: Zpub
 */
function changeVersionBytes(xpub: string, targetFormat: string) {
  if (!prefixes.has(targetFormat)) {
    return 'Invalid target version';
  }

  // trim whitespace
  xpub = xpub.trim();

  try {
    let data = b58.decode(xpub);
    data = data.slice(4);
    data = Buffer.concat([
      Buffer.from(prefixes.get(targetFormat)!, 'hex'),
      data,
    ]);
    return b58.encode(data);
  } catch (err) {
    throw new Error(
      "Invalid extended public key! Please double check that you didn't accidentally paste extra data."
    );
  }
}

export function fromXpub(xub: string, chain: string) {
  const format = chain === 'regtest' ? 'vpub' : 'zpub';
  return changeVersionBytes(xub, format);
}

export function toXpub(anyPub: string) {
  return changeVersionBytes(anyPub, 'xpub');
}

export function isValidXpub(xpub: string, network?: Network): Boolean {
  try {
    fromBase58(xpub, network);
  } catch (e) {
    return false;
  }

  return true;
}

export function isValidExtendedBlindKey(masterBlind: string): Boolean {
  try {
    fromMasterBlindingKey(masterBlind);
  } catch (e) {
    return false;
  }

  return true;
}

export function psetToUnsignedHex(psetBase64: string): string {
  let pset: Psbt;
  try {
    pset = Psbt.fromBase64(psetBase64);
  } catch (ignore) {
    throw new Error('Invalid pset');
  }

  return pset.data.globalMap.unsignedTx.toBuffer().toString('hex');
}

export function psetToUnsignedTx(ptx: string): Transaction {
  return Transaction.fromHex(psetToUnsignedHex(ptx));
}

export function toOutpoint({ txid, vout }: UtxoInterface): Outpoint {
  return { txid, vout };
}

export function isBlindedUtxo({ asset, value }: UtxoInterface): boolean {
  return !asset || !value;
}

export function getNetwork(str?: string): Network {
  return str ? (networks as Record<string, Network>)[str] : networks.liquid;
}

/**
 * take a blinded output and unblind it
 * @param output blinded output
 * @param BlindingPrivateKey blinding private key
 */
export async function unblindOutput(
  output: BlindedOutputInterface,
  BlindingPrivateKey: string
): Promise<UnblindedOutputInterface> {
  const txOutput: TxOutput = {
    asset: output.blindedAsset,
    value: output.blindedValue,
    rangeProof: output.rangeProof,
    surjectionProof: output.surjectionProof,
    nonce: output.nonce,
    script: Buffer.from(output.script, 'hex'),
  };

  const blindPrivateKeyBuffer = Buffer.from(BlindingPrivateKey, 'hex');
  const unblindedResult = await confidential.unblindOutputWithKey(
    txOutput,
    blindPrivateKeyBuffer
  );

  const unblindedOutput: UnblindedOutputInterface = {
    asset: Buffer.from(unblindedResult.asset.reverse()).toString('hex'),
    value: parseInt(unblindedResult.value, 10),
    script: output.script,
    assetBlinder: unblindedResult.assetBlindingFactor.toString('hex'),
    valueBlinder: unblindedResult.valueBlindingFactor.toString('hex'),
  };

  return unblindedOutput;
}

// util function that parse a derivation path and return the index
export function getIndexFromAddress(addr: AddressInterface) {
  if (!addr.derivationPath) {
    throw new Error('need derivation path to be defined');
  }

  const derivationPathSplitted = addr.derivationPath.split('/');

  return parseInt(derivationPathSplitted[derivationPathSplitted.length - 1]);
}

// throws an error if actual is not expect
export function checkIdentityType(actual: IdentityType, expect: IdentityType) {
  if (actual !== expect)
    throw new Error(
      `Incorrect Identity type: need ${expect} and get ${actual}.`
    );
}
