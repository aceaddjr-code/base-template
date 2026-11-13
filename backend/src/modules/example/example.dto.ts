import { Transform, plainToInstance } from 'class-transformer';
import { applyDecorators } from '@nestjs/common';
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsDefined, IsIn, IsInt, IsNotEmpty, IsString, MaxLength, Min, ValidateIf, validateSync } from 'class-validator';
import { BadRequestException } from '@nestjs/common';
import { validationException } from '../../common/utils/validation-errors';

export const EXAMPLE_STATUSES = ['pending', 'doing', 'done'] as const;
const trim = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value;

/** 团队成员（多选用户）：允许 [] / null（清空成员）；去重与存在性校验在服务层（需要数据库） */
function MemberIds() {
  return applyDecorators(
    ValidateIf((_, value) => value !== undefined && value !== null),
    IsArray({ message: '团队成员必须为用户编号数组' }),
    ArrayMaxSize(50, { message: '团队成员一次最多 50 人' }),
    IsInt({ each: true, message: '团队成员包含无效的用户编号' }),
    Min(1, { each: true, message: '团队成员包含无效的用户编号' }),
  );
}

export class BatchRemoveExampleDto {
  @IsArray()
  @ArrayNotEmpty({ message: '请先勾选记录' })
  @ArrayMaxSize(500, { message: '一次最多操作 500 条记录' })
  @IsInt({ each: true })
  @Min(1, { each: true })
  ids: number[];
}

export class CreateExampleDto {
  @Transform(trim)
  @IsDefined({ message: '请填写标题' })
  @IsString()
  @IsNotEmpty({ message: '标题不能为空' })
  @MaxLength(100, { message: '标题不能超过 100 字' })
  title: string;

  @IsIn(EXAMPLE_STATUSES, { message: '状态必须为 pending、doing 或 done' })
  status: string = 'pending';

  @ValidateIf((_, value) => value !== undefined && value !== null)
  @Transform(trim)
  @IsString()
  @MaxLength(50, { message: '类别不能超过 50 字' })
  category?: string | null;

  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(500, { message: '说明不能超过 500 字' })
  description?: string | null;

  @ValidateIf((_, value) => value !== undefined && value !== null)
  @Transform(trim)
  @IsString()
  @MaxLength(500, { message: '备注不能超过 500 字' })
  remark?: string | null;

  @MemberIds()
  memberIds?: number[] | null;
}

export class UpdateExampleDto {
  @ValidateIf((_, value) => value !== undefined)
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: '标题不能为空' })
  @MaxLength(100, { message: '标题不能超过 100 字' })
  title?: string;

  @ValidateIf((_, value) => value !== undefined)
  @IsIn(EXAMPLE_STATUSES, { message: '状态必须为 pending、doing 或 done' })
  status?: string;

  @ValidateIf((_, value) => value !== undefined && value !== null)
  @Transform(trim)
  @IsString()
  @MaxLength(50, { message: '类别不能超过 50 字' })
  category?: string | null;

  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(500, { message: '说明不能超过 500 字' })
  description?: string | null;

  @ValidateIf((_, value) => value !== undefined && value !== null)
  @Transform(trim)
  @IsString()
  @MaxLength(500, { message: '备注不能超过 500 字' })
  remark?: string | null;

  @MemberIds()
  memberIds?: number[] | null;

  @IsDefined({ message: '缺少版本信息，请刷新后重试' })
  @IsInt({ message: '版本信息无效，请刷新后重试' })
  @Min(1, { message: '版本信息无效，请刷新后重试' })
  version?: number;
}

/** 变更单据负责人：独立动作权限（example-items:owner），与普通编辑解耦。 */
export class ChangeExampleOwnerDto {
  @IsDefined({ message: '请选择新的单据负责人' })
  @IsInt({ message: '单据负责人无效，请重新选择' })
  @Min(1, { message: '单据负责人无效，请重新选择' })
  ownerId: number;
}

/** HTTP 写入和 Excel 导入共用业务验证，禁止调用方仅依赖前端校验。 */
export function validateExample(input: unknown, partial: true): UpdateExampleDto;
export function validateExample(input: unknown, partial?: false): CreateExampleDto;
export function validateExample(input: unknown, partial = false): CreateExampleDto | UpdateExampleDto {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BadRequestException('请提交有效的事项数据');
  const dto = partial ? plainToInstance(UpdateExampleDto, input) : plainToInstance(CreateExampleDto, input);
  const errors = validateSync(dto, { whitelist:true, forbidNonWhitelisted:true });
  if (errors.length) throw validationException(errors);
  if (partial && Object.entries(dto).every(([key, value]) => key === 'version' || value === undefined)) throw new BadRequestException('没有可更新的字段');
  return dto;
}
