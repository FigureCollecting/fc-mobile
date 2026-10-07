// A checker for the JSON Schema subset the contract's payload schemas use
// (draft 2020-12). The schemas themselves are the rule: the client checks a
// write against the shipped schema before it mints (sync.proto rule 6,
// PAYLOADS), so a schema change reaches the client with the package and never
// through a hand-copied bound. Fail closed: a keyword this checker does not
// implement makes compileSchema throw, so a later schema cannot be half-checked.

export type Schema = boolean | { [keyword: string]: unknown };
export type Check = (value: unknown) => string | null;

export class SchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SchemaError';
  }
}

const ANNOTATIONS = new Set(['$schema', '$id', '$comment', 'title', 'description']);
const KEYWORDS = new Set([
  'type',
  'enum',
  'const',
  'properties',
  'required',
  'additionalProperties',
  'pattern',
  'minLength',
  'maxLength',
  'minimum',
  'maximum',
  'items',
  'maxItems',
  'if',
  'then',
  'else',
]);
const TYPES = new Set(['object', 'string', 'integer', 'array', 'boolean']);

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const codePoints = (s: string): number => [...s].length;

function typeOk(type: string, v: unknown): boolean {
  if (type === 'object') return isObject(v);
  if (type === 'array') return Array.isArray(v);
  if (type === 'integer') return typeof v === 'number' && Number.isInteger(v);
  return typeof v === type;
}

function num(schema: Record<string, unknown>, keyword: string): number {
  const n = schema[keyword];
  if (typeof n !== 'number') throw new SchemaError(`${keyword} is not a number`);
  return n;
}

export function compileSchema(schema: Schema, path = '$'): Check {
  if (schema === true) return () => null;
  if (schema === false) return () => `${path}: not allowed`;
  if (!isObject(schema)) throw new SchemaError(`${path}: a schema is an object or a boolean`);
  const checks: Check[] = [];
  for (const keyword of Object.keys(schema)) {
    if (!ANNOTATIONS.has(keyword) && !KEYWORDS.has(keyword)) throw new SchemaError(`${path}: unsupported keyword ${keyword}`);
  }

  if ('type' in schema) {
    const type = schema.type;
    if (typeof type !== 'string' || !TYPES.has(type)) throw new SchemaError(`${path}: unsupported type ${JSON.stringify(type)}`);
    checks.push((v) => (typeOk(type, v) ? null : `${path}: not ${type}`));
  }
  if ('enum' in schema) {
    const options = schema.enum;
    if (!Array.isArray(options)) throw new SchemaError(`${path}: enum is not an array`);
    checks.push((v) => (options.some((o) => same(o, v)) ? null : `${path}: not one of the enum`));
  }
  if ('const' in schema) {
    const want = schema.const;
    checks.push((v) => (same(want, v) ? null : `${path}: not the const`));
  }

  const props = schema.properties ?? {};
  if (!isObject(props)) throw new SchemaError(`${path}: properties is not an object`);
  const propChecks = Object.entries(props).map(([name, sub]) => [name, compileSchema(sub as Schema, `${path}.${name}`)] as const);
  const required = schema.required ?? [];
  if (!Array.isArray(required)) throw new SchemaError(`${path}: required is not an array`);
  const extra = 'additionalProperties' in schema ? compileSchema(schema.additionalProperties as Schema, `${path}.*`) : null;
  // Own properties only: `in` would find Object.prototype's names (constructor, __proto__, ...).
  checks.push((v) => {
    if (!isObject(v)) return null;
    for (const name of required) if (!Object.hasOwn(v, name)) return `${path}: missing ${String(name)}`;
    for (const [name, check] of propChecks) {
      if (Object.hasOwn(v, name)) {
        const err = check(v[name]);
        if (err) return err;
      }
    }
    if (extra) {
      for (const name of Object.keys(v)) {
        if (Object.hasOwn(props, name)) continue;
        const err = extra(v[name]);
        if (err) return `${path}: extra property ${name}`;
      }
    }
    return null;
  });

  if ('pattern' in schema) {
    const re = new RegExp(String(schema.pattern), 'u');
    checks.push((v) => (typeof v !== 'string' || re.test(v) ? null : `${path}: does not match its pattern`));
  }
  if ('minLength' in schema) {
    const min = num(schema, 'minLength');
    checks.push((v) => (typeof v !== 'string' || codePoints(v) >= min ? null : `${path}: shorter than ${min}`));
  }
  if ('maxLength' in schema) {
    const max = num(schema, 'maxLength');
    checks.push((v) => (typeof v !== 'string' || codePoints(v) <= max ? null : `${path}: longer than ${max}`));
  }
  if ('minimum' in schema) {
    const min = num(schema, 'minimum');
    checks.push((v) => (typeof v !== 'number' || v >= min ? null : `${path}: below ${min}`));
  }
  if ('maximum' in schema) {
    const max = num(schema, 'maximum');
    checks.push((v) => (typeof v !== 'number' || v <= max ? null : `${path}: above ${max}`));
  }
  if ('maxItems' in schema) {
    const max = num(schema, 'maxItems');
    checks.push((v) => (!Array.isArray(v) || v.length <= max ? null : `${path}: more than ${max} items`));
  }
  if ('items' in schema) {
    const item = compileSchema(schema.items as Schema, `${path}[]`);
    checks.push((v) => {
      if (!Array.isArray(v)) return null;
      for (const x of v) {
        const err = item(x);
        if (err) return err;
      }
      return null;
    });
  }
  if ('if' in schema) {
    const cond = compileSchema(schema.if as Schema, `${path}(if)`);
    const then = 'then' in schema ? compileSchema(schema.then as Schema, path) : null;
    const otherwise = 'else' in schema ? compileSchema(schema.else as Schema, path) : null;
    checks.push((v) => (cond(v) === null ? (then?.(v) ?? null) : (otherwise?.(v) ?? null)));
  }

  return (v) => {
    for (const check of checks) {
      const err = check(v);
      if (err) return err;
    }
    return null;
  };
}
