/**
 * A small shape checker for the JSON files a model writes: exact keys (an
 * unknown key and a missing key are both problems), types, enums, nulls and
 * non-empty arrays. A problem is `<location>: <message>`; the location is a
 * JSON-path-like string such as `screens[0].fields[2].rules[1]`.
 */

import { isObject } from './json-file.mjs';

export const nonEmptyString = Object.freeze({ type: 'string' });
export const literal = (value) => ({ type: 'literal', value });
export const enumOf = (...values) => ({ type: 'enum', values });
/** `schema`, or null. */
export const nullable = (schema) => ({ type: 'nullable', item: schema });
export const arrayOf = (item, { min = 0, max = Infinity } = {}) => ({ type: 'array', item, min, max });
/** `required` and `optional` map a key to its schema. */
export const objectOf = (required, optional = {}) => ({ type: 'object', required, optional });

const here = (path) => (path === '' ? '(top level)' : path);
const child = (path, key) => (path === '' ? key : `${path}.${key}`);
const kind = (value) => (value === null ? 'null' : Array.isArray(value) ? 'an array' : typeof value === 'object' ? 'an object' : `a ${typeof value}`);

/** Every way `value` departs from `schema`; an empty list means it fits. */
export function shapeProblems(value, schema, path = '') {
  switch (schema.type) {
    case 'string':
      return typeof value === 'string' && value.trim() !== '' ? [] : [`${here(path)}: must be a non-empty string, found ${typeof value === 'string' ? 'an empty string' : kind(value)}`];
    case 'literal':
      return value === schema.value ? [] : [`${here(path)}: must be ${JSON.stringify(schema.value)}, found ${JSON.stringify(value)}`];
    case 'enum':
      return schema.values.includes(value) ? [] : [`${here(path)}: must be one of ${schema.values.join(', ')}, found ${JSON.stringify(value)}`];
    case 'nullable':
      return value === null ? [] : shapeProblems(value, schema.item, path);
    case 'array': {
      if (!Array.isArray(value)) return [`${here(path)}: must be an array, found ${kind(value)}`];
      if (value.length < schema.min) return [`${here(path)}: must have at least ${schema.min} item${schema.min === 1 ? '' : 's'}`];
      if (value.length > schema.max) return [`${here(path)}: must have at most ${schema.max} item${schema.max === 1 ? '' : 's'}`];
      return value.flatMap((item, index) => shapeProblems(item, schema.item, `${path}[${index}]`));
    }
    case 'object': {
      if (!isObject(value)) return [`${here(path)}: must be an object, found ${kind(value)}`];
      const problems = [];
      for (const [key, sub] of Object.entries(schema.required)) {
        if (!Object.hasOwn(value, key)) problems.push(`${here(path)}: missing key "${key}"`);
        else problems.push(...shapeProblems(value[key], sub, child(path, key)));
      }
      for (const [key, sub] of Object.entries(schema.optional)) {
        if (Object.hasOwn(value, key)) problems.push(...shapeProblems(value[key], sub, child(path, key)));
      }
      for (const key of Object.keys(value)) {
        if (!Object.hasOwn(schema.required, key) && !Object.hasOwn(schema.optional, key)) problems.push(`${here(path)}: unexpected key "${key}"`);
      }
      return problems;
    }
    default:
      throw new TypeError(`unknown schema type ${schema.type}`);
  }
}
