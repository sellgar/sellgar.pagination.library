require('reflect-metadata');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { test } = require('node:test');
const { DataSource, EntitySchema } = require('typeorm');
const { CursorPagination } = require('../dist');
const pagination = new CursorPagination('test-pagination-key-at-least-32-bytes');

test(
  'PostgreSQL keysets preserve microseconds, complete JOIN relations and page boundaries without COUNT',
  {
    skip: !process.env.PAGINATION_TEST_DATABASE_URL,
  },
  async () => {
    const schema = 'pagination_test_' + randomUUID().replaceAll('-', '');
    const queries = [];
    const parent = new EntitySchema({
      name: 'PageParent',
      tableName: 'page_parent',
      schema,
      columns: {
        uuid: { type: 'uuid', primary: true },
        groupUuid: { name: 'group_uuid', type: 'uuid' },
        createdAt: { name: 'created_at', type: 'timestamptz' },
        rank: { type: 'real' },
      },
      relations: {
        children: {
          type: 'one-to-many',
          target: 'PageChild',
          inverseSide: 'parent',
        },
      },
    });
    const child = new EntitySchema({
      name: 'PageChild',
      tableName: 'page_child',
      schema,
      columns: {
        uuid: { type: 'uuid', primary: true },
        parentUuid: { name: 'parent_uuid', type: 'uuid' },
      },
      relations: {
        parent: {
          type: 'many-to-one',
          target: 'PageParent',
          joinColumn: { name: 'parent_uuid' },
          inverseSide: 'children',
        },
      },
    });
    const source = new DataSource({
      type: 'postgres',
      url: process.env.PAGINATION_TEST_DATABASE_URL,
      schema,
      entities: [parent, child],
      synchronize: false,
      logger: {
        logQuery: (sql) => queries.push(sql),
        logQueryError() {},
        logQuerySlow() {},
        logSchemaBuild() {},
        logMigration() {},
        log() {},
      },
      logging: ['query'],
    });
    await source.initialize();
    try {
      await source.query(`CREATE SCHEMA "${schema}"`);
      await source.query(
        `CREATE TABLE "${schema}".page_parent (uuid uuid PRIMARY KEY, group_uuid uuid NOT NULL, created_at timestamptz NOT NULL, rank real NOT NULL)`,
      );
      await source.query(
        `CREATE TABLE "${schema}".page_child (uuid uuid PRIMARY KEY, parent_uuid uuid NOT NULL REFERENCES "${schema}".page_parent(uuid) ON DELETE CASCADE)`,
      );
      const group = randomUUID();
      const ids = Array.from(
        { length: 5 },
        (_, index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      );
      for (const [index, uuid] of ids.entries()) {
        await source.query(`INSERT INTO "${schema}".page_parent VALUES ($1,$2,$3,$4)`, [
          uuid,
          group,
          `2026-11-22 12:00:00.${String(123456 - Math.floor(index / 2)).padStart(6, '0')}+00`,
          index < 3 ? '0.12345678' : '0.12345670',
        ]);
        for (let childIndex = 0; childIndex < 3; childIndex++)
          await source.query(`INSERT INTO "${schema}".page_child VALUES ($1,$2)`, [randomUUID(), uuid]);
      }
      const build = () =>
        source
          .getRepository(parent)
          .createQueryBuilder('parent')
          .leftJoinAndSelect('parent.children', 'children')
          .where('parent.groupUuid = :group', { group })
          .addOrderBy('children.uuid', 'ASC');
      const context = {
        scope: 'test.parents',
        filters: { group },
        order: [
          {
            expression: 'parent.createdAt',
            direction: 'DESC',
            type: 'timestamptz',
          },
          { expression: 'parent.uuid', direction: 'ASC', type: 'uuid' },
        ],
      };
      let nextToken;
      const seen = [];
      do {
        const page = await pagination.read(build(), { limit: 2, nextToken }, context);
        assert.deepEqual(Object.keys(page.meta).sort(), ['limit', 'nextToken']);
        assert.ok(page.data.every((row) => row.children.length === 3));
        seen.push(...page.data.map((row) => row.uuid));
        nextToken = page.meta.nextToken;
      } while (nextToken !== null);
      assert.deepEqual(seen, ids);
      const exact = await pagination.read(build(), { limit: 5 }, context);
      assert.equal(exact.meta.nextToken, null);
      const first = await pagination.read(build(), { limit: 2 }, context);
      await source.query(`DELETE FROM "${schema}".page_parent WHERE uuid=$1`, [ids[1]]);
      await source.query(`INSERT INTO "${schema}".page_parent VALUES ($1,$2,'2027-01-01',1)`, [randomUUID(), group]);
      const rest = await pagination.read(build(), { limit: 100, nextToken: first.meta.nextToken }, context);
      assert.deepEqual(
        rest.data.map((row) => row.uuid),
        ids.slice(2),
      );
      assert.equal(rest.meta.nextToken, null);
      const empty = await pagination.read(
        build().andWhere('parent.uuid = :missing', { missing: randomUUID() }),
        {},
        { ...context, filters: { missing: true } },
      );
      assert.deepEqual(empty, {
        data: [],
        meta: { limit: 50, nextToken: null },
      });
      const ranked = {
        ...context,
        scope: 'test.rank',
        order: [{ expression: 'parent.rank', direction: 'DESC', type: 'real' }, context.order[1]],
      };
      const rankFirst = await pagination.read(build(), { limit: 2 }, ranked);
      const rankRest = await pagination.read(build(), { limit: 100, nextToken: rankFirst.meta.nextToken }, ranked);
      assert.equal(new Set([...rankFirst.data, ...rankRest.data].map((row) => row.uuid)).size, 5);
      await assert.rejects(
        pagination.read(build(), { nextToken: first.meta.nextToken }, { ...context, filters: { group: randomUUID() } }),
        (error) => error.getStatus() === 400,
      );
      assert.equal(queries.filter((sql) => /COUNT\s*\(/i.test(sql)).length, 0);
      assert.ok(queries.some((sql) => /LIMIT 3/.test(sql)));
      assert.ok(queries.some((sql) => sql.includes(' UNION ALL ')));
    } finally {
      await source.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await source.destroy();
    }
  },
);
