

/** 字段类型（列管理通用） */
export type FieldType = 'text' | 'date' | 'select' | 'tag' | 'number' | 'image';

/** 字段配置（列管理通用） */
export interface FieldConfig {
  key: string;
  label: string;
  type: FieldType;
  visible: boolean;
  sortable: boolean;
  filterable: boolean;
  width?: number;
  fixed?: 'left' | 'right';
  options?: string[];
}
