import { Expose, Transform, Type } from 'class-transformer';
import { Equals, IsInt, IsString, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';

export class CursorQueryDto {
  @Expose()
  @Type(() => Number)
  @Transform(({ value }) => (value === undefined ? 50 : value))
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 50;

  @Expose()
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(8192)
  nextToken?: string;

  @Expose()
  @Equals(undefined, { message: 'offset is not supported; use nextToken' })
  offset?: never;
}
