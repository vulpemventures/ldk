const namespaceRegexp = new RegExp('[$][a-zA-Z0-9|@_.-]+', 'g');

export interface Context {
  // map namespace token to public key
  namespaces: Map<string, { pubkey: string }>;
}

function replaceAll(str: string, find: string, replace: string): string {
  return str.split(find).join(replace);
}

export function findNamespaces(text: string): Array<string> {
  const namespaces = Array.from(new Set(text.match(namespaceRegexp)));
  if (!namespaces) return [];
  return namespaces.map(n => n.slice(1)); // remove the '$' token
}

export function processNamespaces(
  ctx: Context['namespaces'],
  text: string
): string {
  const namespaces = findNamespaces(text);
  if (!namespaces.length) return text;

  let processedText = text;
  for (const namespace of namespaces) {
    const namespacePublicKey = ctx.get(namespace)?.pubkey;
    if (!namespacePublicKey)
      throw new Error(`Could not find namespace context: ${namespace}`);
    processedText = replaceAll(
      processedText,
      '$' + namespace,
      namespacePublicKey
    );
  }

  return processedText;
}

export function preprocessor(ctx: Context, text: string): string {
  return processNamespaces(ctx.namespaces, text);
}
