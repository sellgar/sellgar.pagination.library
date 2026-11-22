import { Expose } from 'class-transformer';
import { IsInt, IsString, Max, Min, ValidateIf } from 'class-validator';

export class CursorMetaEntity {
  @Expose()
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number;

  @Expose()
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  nextToken: string | null;
}
