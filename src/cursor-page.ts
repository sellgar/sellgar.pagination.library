import { CursorMetaEntity } from './cursor-meta.entity';

export interface CursorPage<T> {
  data: T[];
  meta: CursorMetaEntity;
}
