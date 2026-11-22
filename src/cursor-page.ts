import { CursorMetaEntity } from './cursor-meta.entity';

export interface CursorPage<T> {
  items: T[];
  meta: CursorMetaEntity;
}
