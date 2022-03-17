import { SLIP77Factory } from 'slip77';
import { ecc } from './ecclib';

export const slip77 = SLIP77Factory(ecc);
