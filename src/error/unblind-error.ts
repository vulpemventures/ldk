export default class UnblindError extends Error {
  constructor(txid: string, vout: number, blindingKey: string) {
    super(
      `UnblindError output (${txid}:${vout}) with blind key ${blindingKey}`
    );
  }
}
