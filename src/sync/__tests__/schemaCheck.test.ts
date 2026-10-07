import { describe, expect, it } from 'vitest';
import { SchemaError, compileSchema, type Schema } from '../schemaCheck';

const ok = (schema: Schema, v: unknown) => compileSchema(schema)(v) === null;

describe('compileSchema: the keywords the contract schemas use', () => {
  it('accepts everything under true and nothing under false', () => {
    expect(ok(true, { any: 1 })).toBe(true);
    expect(compileSchema(false)('x')).toBe('$: not allowed');
  });

  it.each([
    ['object', {}, []],
    ['string', 'a', 1],
    ['integer', 3, 3.5],
    ['array', [], {}],
    ['boolean', false, 0],
  ] as const)('checks type %s', (type, good, bad) => {
    expect(ok({ type }, good)).toBe(true);
    expect(ok({ type }, bad)).toBe(false);
  });

  it('checks enum and const by value', () => {
    expect(ok({ enum: ['a', 'b'] }, 'b')).toBe(true);
    expect(ok({ enum: ['a', 'b'] }, 'c')).toBe(false);
    expect(ok({ const: 'per_copy' }, 'per_copy')).toBe(true);
    expect(ok({ const: 'per_copy' }, 'keep')).toBe(false);
  });

  it('checks required, properties and a closed object', () => {
    const s: Schema = { type: 'object', additionalProperties: false, required: ['a'], properties: { a: { type: 'string' }, b: { type: 'integer' } } };
    expect(ok(s, { a: 'x' })).toBe(true);
    expect(ok(s, { a: 'x', b: 2 })).toBe(true);
    expect(compileSchema(s)({})).toBe('$: missing a');
    expect(compileSchema(s)({ a: 1 })).toBe('$.a: not string');
    expect(compileSchema(s)({ a: 'x', c: 1 })).toBe('$: extra property c');
    expect(ok({ properties: { a: { type: 'string' } } }, { c: 1 })).toBe(true);
    expect(ok({ properties: { a: { type: 'string' } }, additionalProperties: true }, { c: 1 })).toBe(true);
    expect(ok({ additionalProperties: { type: 'string' } }, { c: 'x' })).toBe(true);
    expect(ok({ additionalProperties: { type: 'string' } }, { c: 1 })).toBe(false);
  });

  // `name in v` walks the prototype chain: every Object.prototype name looked declared, present
  // or required. JSON.parse makes __proto__ an own property, as a payload off the wire would.
  it.each(['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__'])('treats %s as just another property name', (name) => {
    const closed: Schema = { type: 'object', additionalProperties: false, properties: { a: { type: 'string' } } };
    expect(compileSchema(closed)(JSON.parse(`{"a":"x","${name}":"y"}`))).toBe(`$: extra property ${name}`);
    expect(compileSchema({ type: 'object', required: [name] })({})).toBe(`$: missing ${name}`);
    expect(ok({ type: 'object', properties: { [name]: { type: 'integer' } } }, {})).toBe(true);
  });

  it('applies object, string, number and array keywords only to their own type', () => {
    expect(ok({ required: ['a'], minLength: 2, minimum: 1, maxItems: 0, items: false, pattern: '^z$' }, true)).toBe(true);
    expect(ok({ required: ['a'], maxItems: 0, items: false, minimum: 1 }, 'x')).toBe(true);
    expect(ok({ pattern: '^a$', maxLength: 1, maximum: 0 }, 5)).toBe(false);
    expect(ok({ pattern: '^a$', maxLength: 1 }, 5)).toBe(true);
  });

  it('counts string length in code points', () => {
    expect(ok({ maxLength: 2 }, '\u{1F600}\u{1F600}')).toBe(true);
    expect(ok({ maxLength: 2 }, '\u{1F600}\u{1F600}x')).toBe(false);
    expect(ok({ minLength: 2 }, '\u{1F600}')).toBe(false);
    expect(ok({ minLength: 1 }, '\u{1F600}')).toBe(true);
  });

  it('checks pattern, minimum, maximum, maxItems and items', () => {
    expect(ok({ pattern: '^[a-z]+$' }, 'abc')).toBe(true);
    expect(ok({ pattern: '^[a-z]+$' }, 'aBc')).toBe(false);
    expect(ok({ minimum: 1, maximum: 10 }, 1)).toBe(true);
    expect(ok({ minimum: 1, maximum: 10 }, 10)).toBe(true);
    expect(ok({ minimum: 1, maximum: 10 }, 0)).toBe(false);
    expect(ok({ minimum: 1, maximum: 10 }, 11)).toBe(false);
    expect(ok({ maxItems: 2 }, [1, 2])).toBe(true);
    expect(ok({ maxItems: 2 }, [1, 2, 3])).toBe(false);
    expect(ok({ items: { type: 'string' } }, ['a', 'b'])).toBe(true);
    expect(compileSchema({ items: { type: 'string' } })(['a', 2])).toBe('$[]: not string');
  });

  it('runs then when if holds and else when it does not', () => {
    const s: Schema = {
      properties: { choice: { enum: ['keep', 'per_copy'] } },
      if: { properties: { choice: { const: 'per_copy' } } },
      then: { required: ['copies'] },
      else: { properties: { copies: false } },
    };
    expect(ok(s, { choice: 'per_copy', copies: [] })).toBe(true);
    expect(ok(s, { choice: 'per_copy' })).toBe(false);
    expect(ok(s, { choice: 'keep' })).toBe(true);
    expect(ok(s, { choice: 'keep', copies: [] })).toBe(false);
    expect(ok({ if: { const: 1 } }, 2)).toBe(true);
    expect(ok({ if: { const: 1 } }, 1)).toBe(true);
  });

  it('ignores annotations', () => {
    expect(ok({ $schema: 'x', $id: 'y', $comment: 'z', title: 't', description: 'd' }, 1)).toBe(true);
  });
});

describe('compileSchema fails closed', () => {
  it.each([
    [{ oneOf: [] }, 'unsupported keyword oneOf'],
    [{ type: 'number' }, 'unsupported type "number"'],
    [{ type: ['string', 'null'] }, 'unsupported type'],
    [{ enum: 'a' }, 'enum is not an array'],
    [{ properties: [] }, 'properties is not an object'],
    [{ required: 'a' }, 'required is not an array'],
    [{ maxLength: '3' }, 'maxLength is not a number'],
    [{ properties: { a: 3 } }, 'a schema is an object or a boolean'],
    [{ items: { format: 'date' } }, 'unsupported keyword format'],
  ] as const)('refuses %j', (schema, message) => {
    expect(() => compileSchema(schema as never)).toThrow(SchemaError);
    expect(() => compileSchema(schema as never)).toThrow(message);
  });
});
