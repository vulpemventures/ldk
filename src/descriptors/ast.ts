import { bip341 } from 'liquidjs-lib';

export enum TypeAST {
  SCRIPT = 0, // one of ScriptType
  TREE, // {asm(...)|TREE,asm(...)|TREE}
  HEX, // ? bits hex
  KEY, // 64 bits hex
}

export enum ScriptType {
  ELTR = 'eltr', // eltr(KEY, TREE)
  ASM = 'asm', // asm(STRING)
  RAW = 'raw', // raw(HEX)
}

const numOfChildren = new Map<ScriptType, number>()
  .set(ScriptType.ELTR, 2)
  .set(ScriptType.ASM, 1)
  .set(ScriptType.RAW, 1);

// Abstract syntax tree
export interface AST<V = any> {
  type: TypeAST;
  value: V;
  children: AST[];
}

export interface DescriptorsCompilerAPI {
  compile: (ast: AST) => TemplateResult;
}

// (template string, context) --parser--> AST --compiler--> Result object
export interface TemplateResult {
  scriptPubKey(): Buffer; // the address' script
  redeemScript?(): Buffer; // optional, only if needed to spend the scriptPubKey (e.g. for P2SH, P2WSH, P2WSH-P2SH...)
  // optional, returns witnesses needed to spend the scriptPubKey
  // in case of segwit v0 = [redeemScript()]
  // in case of segwit v1 = [leafScript, taprootControlBlock]
  witnesses?(...args: any[]): Buffer[];
  taprootHashTree?: bip341.HashTree; // optional, should be undefined if not an eltr template
  taprootInternalKey?: string; // optional, should be undefined if not an eltr template
}

const withoutEccCompilers = new Map([
  [ScriptType.RAW, compileRAW],
  [ScriptType.ASM, compileASM],
]);

function compileFromEcc(ecc: bip341.TinySecp256k1Interface) {
  // map cmd to compile functions
  const compilers = withoutEccCompilers.set(
    ScriptType.ELTR,
    makeCompileELTR(bip341.BIP341Factory(ecc))
  );

  return (ast: AST): TemplateResult => {
    return compileScript(ast, compilers, true);
  };
}

export const DescriptorsCompilerFactory = (
  ecc: bip341.TinySecp256k1Interface
): DescriptorsCompilerAPI => {
  return {
    compile: compileFromEcc(ecc),
  };
};

function checkScriptNode(ast: AST, scriptType: ScriptType): void {
  if (ast.type !== TypeAST.SCRIPT) {
    throw new Error('Expected script node');
  }

  if (ast.value !== scriptType) {
    throw new Error(`Expected ${scriptType} script`);
  }

  if (ast.children.length !== numOfChildren.get(ast.value)) {
    throw new Error(
      `Expected script node ${ast.type} with ${numOfChildren.get(
        ast.value
      )} of children`
    );
  }
}

function compileHEX(ast: AST): TemplateResult {
  if (ast.type !== TypeAST.HEX) {
    throw new Error('Expected hex node');
  }

  if (typeof ast.value !== 'string')
    throw new Error('Expected hex node with string value');
  const script = Buffer.from(ast.value, 'hex');
  return {
    scriptPubKey: () => script,
  };
}

// 'raw' node
function compileRAW(ast: AST): TemplateResult {
  checkScriptNode(ast, ScriptType.RAW);
  return compileHEX(ast.children[0]);
}

// 'asm' node, which is a subset of raw
function compileASM(ast: AST): TemplateResult {
  checkScriptNode(ast, ScriptType.ASM);
  return compileHEX(ast.children[0]);
}

// this is not a ScriptCompileFunction
// recursive way to get all the leaves of the tree
function compileTREE(ast: AST): bip341.TaprootLeaf[] {
  if (ast.type !== TypeAST.TREE) {
    throw new Error('Expected tree node');
  }

  const leaves: bip341.TaprootLeaf[] = [];
  if (ast.children.length < 1 || ast.children.length > 2) {
    throw new Error('Expected tree node with 1 or 2 leaves');
  }

  for (const child of ast.children) {
    switch (child.type) {
      case TypeAST.SCRIPT:
        leaves.push({
          scriptHex: compileScript(child, withoutEccCompilers) // we do not expect any toplevel compilers so we can use withoutEccCompilers
            .scriptPubKey()
            .toString('hex'),
        });
        break;
      case TypeAST.TREE:
        leaves.push(...compileTREE(child));
        break;
      default:
        throw new Error(
          `Expected tree node with children of type ${TypeAST.SCRIPT} or ${TypeAST.TREE}`
        );
    }
  }

  return leaves;
}

function compileKEY(ast: AST): Buffer {
  if (ast.type !== TypeAST.KEY) {
    throw new Error('Expected key node');
  }

  if (typeof ast.value !== 'string' && ast.value.length === 64)
    throw new Error('Expected key (64 hex chars)');
  return Buffer.from(ast.value, 'hex');
}

function makeCompileELTR(bip341lib: bip341.BIP341API) {
  return function(ast: AST): TemplateResult {
    checkScriptNode(ast, ScriptType.ELTR);

    if (ast.children[0].type !== TypeAST.KEY) {
      throw new Error('Expected KEY as first argument of eltr');
    }

    if (ast.children[1].type !== TypeAST.TREE) {
      throw new Error('Expected TREE as second argument of eltr');
    }

    const internalKey = compileKEY(ast.children[0]);
    const leaves = compileTREE(ast.children[1]);

    const tree = bip341.toHashTree(leaves, true);
    // this is a trick for the bip341 functions (accept only prefixed keys)
    const prefixedInternalKey = Buffer.concat([Buffer.of(0x00), internalKey]);

    // segwit v1 scriptPubKey
    const scriptPubKey = bip341lib.taprootOutputScript(
      prefixedInternalKey,
      tree
    );

    return {
      witnesses: (leafScript: string): Buffer[] => {
        const leaf = leaves.find(l => l.scriptHex === leafScript);
        if (!leaf) {
          throw new Error(
            'Could not find leaf script for script ' + leafScript
          );
        }

        const path = bip341.findScriptPath(tree, bip341.tapLeafHash(leaf));
        return bip341lib.taprootSignScriptStack(
          prefixedInternalKey,
          leaf,
          tree.hash,
          path
        );
      },
      scriptPubKey: () => scriptPubKey,
      taprootHashTree: tree,
      taprootInternalKey: internalKey.toString('hex'),
    };
  };
}

const topLevelOnly = [ScriptType.RAW, ScriptType.ELTR];

type CompilersMap = Map<ScriptType, ScriptCompileFunction>;
type ScriptCompileFunction = (ast: AST) => TemplateResult;

// main compile function
function compileScript(
  ast: AST,
  compilersMap: CompilersMap,
  isTop = false
): TemplateResult {
  const compileFunction = compilersMap.get(ast.value);
  if (!compileFunction) {
    throw new Error(`node type: ${ast.type} is not a descriptor`);
  }

  if (!isTop && topLevelOnly.includes(ast.value)) {
    throw new Error(`node type: ${ast.value} is a top level only descriptor`);
  }

  return compileFunction(ast);
}
