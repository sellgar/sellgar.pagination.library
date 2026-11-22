import { BadRequestException } from '@nestjs/common';
import { ObjectLiteral, SelectQueryBuilder } from 'typeorm';

import { CursorOrder } from './cursor-order';
import { CursorPage } from './cursor-page';
import { CursorToken } from './cursor-token';

export class CursorPagination {
  constructor(private readonly secret: string) {
    new CursorToken('configuration-check', {}, [], secret);
  }

  async read<T extends ObjectLiteral>(
    query: SelectQueryBuilder<T>,
    request: { limit?: number; nextToken?: string; offset?: unknown },
    context: { scope: string; filters: unknown; order: readonly CursorOrder[] },
  ): Promise<CursorPage<T>> {
    const limit = request.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || request.offset !== undefined) {
      throw new BadRequestException('Use limit between 1 and 100 and nextToken; offset is not supported');
    }
    const alias = query.expressionMap.mainAlias!;
    const primaryColumns = alias.metadata.primaryColumns;
    if (primaryColumns.length !== 1 || context.order.length === 0) {
      throw new Error('Cursor pagination requires one primary key and a stable unique order');
    }
    const identity = `${alias.name}.${primaryColumns[0].propertyPath}`;
    if (context.order.at(-1)?.expression !== identity) {
      throw new Error('The final cursor order must be the primary key');
    }
    const token = new CursorToken(context.scope, context.filters, context.order, this.secret);
    const headers = query.clone().select(identity, '__page_id').orderBy().distinct(true);
    context.order.forEach((key, index) => {
      if (key.expression !== identity) headers.addSelect(key.expression, `__page_order_${index}`);
      headers.addSelect(`CAST(${key.expression} AS text)`, `__page_key_${index}`);
      headers.addOrderBy(key.expression === identity ? '__page_id' : `__page_order_${index}`, key.direction);
    });
    let roots: SelectQueryBuilder<ObjectLiteral> = headers;
    if (request.nextToken !== undefined) {
      const keys = token.decode(request.nextToken);
      const clauses = context.order.map((key, index) => {
        const equals = context.order
          .slice(0, index)
          .map(
            (previous, previousIndex) =>
              `${previous.expression} = CAST(:__page_key_${previousIndex} AS ${previous.type})`,
          );
        const comparison = `${key.expression} ${key.direction === 'ASC' ? '>' : '<'} CAST(:__page_key_${index} AS ${key.type})`;
        return `(${[...equals, comparison].join(' AND ')})`;
      });
      const parameters = Object.fromEntries(keys.map((key, index) => [`__page_key_${index}`, key]));
      const branches = clauses.map((clause) =>
        headers
          .clone()
          .andWhere(clause, parameters)
          .limit(limit + 1),
      );
      if (branches.length === 1) {
        roots = branches[0];
      } else {
        const union = branches.map((branch) => '(' + branch.getQuery() + ')').join(' UNION ALL ');
        roots = headers
          .createQueryBuilder()
          .select('*')
          .from('(' + union + ')', '__page_union')
          .setParameters(headers.getParameters())
          .setParameters(parameters);
        context.order.forEach((key, index) =>
          roots.addOrderBy(
            key.expression === identity ? '__page_union.__page_id' : `__page_union.__page_order_${index}`,
            key.direction,
          ),
        );
      }
    }
    const rows = await roots.limit(limit + 1).getRawMany<Record<string, string>>();
    const page = rows.slice(0, limit);
    const ids = page.map((row) => row.__page_id);
    const entities =
      ids.length === 0
        ? []
        : await query.clone().andWhere(`${identity} IN (:...__page_ids)`, { __page_ids: ids }).getMany();
    const byId = new Map(entities.map((item) => [String(item[primaryColumns[0].propertyName]), item]));
    const last = page.at(-1);
    return {
      data: ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : [])),
      meta: {
        limit,
        nextToken:
          rows.length > limit && last
            ? token.encode(context.order.map((_key, index) => last[`__page_key_${index}`]))
            : null,
      },
    };
  }
}
