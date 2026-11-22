import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { CursorPagination } from './cursor-pagination';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: CursorPagination,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => new CursorPagination(config.getOrThrow<string>('PAGINATION_TOKEN_SECRET')),
    },
  ],
  exports: [CursorPagination],
})
export class PaginationModule {}
