import { SLIP77Factory } from 'slip77';
import * as ecc from 'tiny-secp256k1';

export const slip77 = SLIP77Factory(ecc);
