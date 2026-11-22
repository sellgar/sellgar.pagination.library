require('reflect-metadata');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { plainToInstance } = require('class-transformer');
const { validate } = require('class-validator');
const { CursorToken, CursorQueryDto, CursorMetaEntity } = require('../dist');

const order = [
  { expression: 'record.createdAt', direction: 'DESC', type: 'timestamptz' },
  { expression: 'record.uuid', direction: 'ASC', type: 'uuid' },
];
const uuid = '00000000-0000-4000-8000-000000000001';

test('token preserves exact PostgreSQL keys and canonicalizes filter property order', () => {
  const token = new CursorToken('records', { status: 'active', shop: uuid }, order);
  const keys = ['2026-11-22 12:00:00.123456+00', uuid];
  const encoded = token.encode(keys);
  assert.match(encoded, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(new CursorToken('records', { shop: uuid, status: 'active' }, order).decode(encoded), keys);
});

test('token rejects another scope, changed filters or ordering, malformed values and oversized input', () => {
  const token = new CursorToken('records', { status: 'active' }, order);
  const encoded = token.encode(['2026-11-22 12:00:00.123456+00', uuid]);
  for (const target of [
    new CursorToken('shops', { status: 'active' }, order),
    new CursorToken('records', { status: 'closed' }, order),
    new CursorToken('records', { status: 'active' }, [{ ...order[0], direction: 'ASC' }, order[1]]),
  ])
    assert.throws(
      () => target.decode(encoded),
      (error) => error.getStatus() === 400,
    );
  for (const value of [
    '',
    'not-json',
    'a'.repeat(8193),
    encoded + '=',
    token.encode(['invalid-date', uuid]),
    token.encode(['2026-11-22', 'invalid-uuid']),
  ]) {
    assert.throws(
      () => token.decode(value),
      (error) => error.getStatus() === 400,
    );
  }
});

test('DTO defaults and bounds are uniform; offset and explicit invalid tokens are rejected', async () => {
  const defaultQuery = plainToInstance(CursorQueryDto, {});
  assert.equal(defaultQuery.limit, 50);
  assert.equal((await validate(defaultQuery)).length, 0);
  assert.equal(plainToInstance(CursorQueryDto, {}, { excludeExtraneousValues: true }).limit, 50);
  const exposed = plainToInstance(
    CursorQueryDto,
    { limit: 10, nextToken: 'bookmark' },
    { excludeExtraneousValues: true },
  );
  assert.equal(exposed.limit, 10);
  assert.equal(exposed.nextToken, 'bookmark');
  for (const query of [
    { limit: 0 },
    { limit: 101 },
    { limit: 1.5 },
    { nextToken: '' },
    { nextToken: null },
    { offset: 0 },
    { offset: null },
  ]) {
    assert.ok((await validate(plainToInstance(CursorQueryDto, query))).length > 0);
  }
  assert.equal((await validate(plainToInstance(CursorQueryDto, { limit: '10', nextToken: 'bookmark' }))).length, 0);
});

test('meta requires explicit valid continuation state', async () => {
  assert.equal((await validate(plainToInstance(CursorMetaEntity, { limit: 50, nextToken: null }))).length, 0);
  assert.equal((await validate(plainToInstance(CursorMetaEntity, { limit: 50, nextToken: 'bookmark' }))).length, 0);
  for (const meta of [{ limit: 50 }, { limit: 0, nextToken: null }]) {
    assert.ok((await validate(plainToInstance(CursorMetaEntity, meta))).length > 0);
  }
});
