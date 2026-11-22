import { BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { isUUID } from 'class-validator';

import { CursorOrder } from './cursor-order';

export class CursorToken {
  private readonly fingerprint: string;

  constructor(
    scope: string,
    filters: unknown,
    private readonly order: readonly CursorOrder[],
  ) {
    this.fingerprint = createHash('sha256')
      .update(JSON.stringify([scope, this.canonical(filters), order]))
      .digest('base64url');
  }

  encode(keys: string[]): string {
    return Buffer.from(JSON.stringify([1, this.fingerprint, keys])).toString('base64url');
  }

  decode(token: string): string[] {
    try {
      if (!token || token.length > 8192 || !/^[A-Za-z0-9_-]+$/.test(token)) throw new Error();
      const bytes = Buffer.from(token, 'base64url');
      if (bytes.toString('base64url') !== token) throw new Error();
      const payload: unknown = JSON.parse(bytes.toString('utf8'));
      if (!Array.isArray(payload) || payload.length !== 3 || payload[0] !== 1 || payload[1] !== this.fingerprint) {
        throw new Error();
      }
      const keys: unknown = payload[2];
      if (!Array.isArray(keys) || keys.length !== this.order.length) throw new Error();
      if (keys.some((value, index) => !this.validKey(value, this.order[index]))) throw new Error();
      return keys as string[];
    } catch {
      throw new BadRequestException('Invalid nextToken or changed query filters');
    }
  }

  private canonical(value: unknown): unknown {
    if (Array.isArray(value)) return value.map((item) => this.canonical(item));
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value)
          .filter(([, item]) => item !== undefined)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, item]) => [key, this.canonical(item)]),
      );
    }
    return value;
  }

  private validKey(value: unknown, order: CursorOrder): value is string {
    if (typeof value !== 'string' || value.length > 1024) return false;
    if (order.type === 'uuid') return isUUID(value);
    if (order.type === 'timestamptz') return value.length <= 64 && Number.isFinite(Date.parse(value));
    if (order.type === 'integer') return /^-?\d+$/.test(value);
    if (order.type === 'numeric' || order.type === 'real') {
      return /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(value) && Number.isFinite(Number(value));
    }
    return true;
  }
}
