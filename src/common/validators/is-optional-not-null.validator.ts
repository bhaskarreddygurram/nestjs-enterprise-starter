import { ValidateIf } from 'class-validator';

/**
 * Like `@IsOptional()`, but only `undefined` skips validation. `@IsOptional()`
 * also lets an explicit `null` through, which is wrong for a field that may be
 * omitted but can never be cleared (a NOT NULL column): `{ "status": null }`
 * must be a 400, not a database error.
 */
export const IsOptionalNotNull = (): PropertyDecorator =>
  ValidateIf((_object: object, value: unknown) => value !== undefined);
