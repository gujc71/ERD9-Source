import type { DbmsType } from "../constants";

/** 데이터 타입 목록. Y: 자릿수 지정 필요 */
type DataTypeList = Record<string, "Y" | "N">;
type DataTypeMatch = Record<string, string>;

/** 타입별 자릿수 규칙. 변환 결과의 자릿수를 이 규칙으로 정리한다 */
interface TypeSpec {
  /** 입력 도우미에서 자릿수를 입력하게 함 */
  required?: boolean;
  /** 받는 자릿수 개수. 0(또는 생략)이면 자릿수를 버림 (INT(11) -> INTEGER) */
  args?: 0 | 1 | 2;
  /** 첫 자릿수(길이/정밀도) 최댓값. 넘으면 big으로 바꾸고, big이 없으면 최댓값으로 */
  max?: number;
  /** 소수 자릿수 최댓값 */
  maxScale?: number;
  /** (MAX) 허용 */
  allowMax?: boolean;
  /** (MAX)이거나 최댓값을 넘을 때 쓸 타입 */
  big?: string;
  /** 자릿수 없이 쓰면 범위 제한이 없는 타입 (Oracle NUMBER, PostgreSQL NUMERIC/VARCHAR) */
  unbounded?: boolean;
  /** 범위 제한이 없는 원본을 받을 때 붙일 자릿수 (MariaDB DECIMAL은 기본이 (10,0)이라 소수가 잘림) */
  unboundedArgs?: number[];
}

const N: TypeSpec = {};
const len = (max: number, big?: string, extra: TypeSpec = {}): TypeSpec => ({ required: true, args: 1, max, big, ...extra });
const fraction = (max: number): TypeSpec => ({ args: 1, max });

const typeSpecs: Record<DbmsType, Record<string, TypeSpec>> = {
  oracle: {
    'NUMBER': { required: true, args: 2, max: 38, unbounded: true },
    'FLOAT': { args: 1, max: 126 },
    'BINARY_FLOAT': N,
    'BINARY_DOUBLE': N,
    'INTEGER': N,
    'CHAR': len(2000, 'CLOB'),
    'NCHAR': len(1000, 'NCLOB'),
    'VARCHAR2': len(4000, 'CLOB'),
    'NVARCHAR2': len(2000, 'NCLOB'),
    'RAW': len(2000, 'BLOB'),
    'LONG': N,
    'CLOB': N,
    'NCLOB': N,
    'BLOB': N,
    'DATE': N,
    'TIMESTAMP': fraction(9),
    'TIMESTAMP WITH TIME ZONE': fraction(9),
    'TIMESTAMP WITH LOCAL TIME ZONE': fraction(9),
    'INTERVAL YEAR TO MONTH': N,
    'INTERVAL DAY TO SECOND': N,
    'XMLTYPE': N,
    'ROWID': N
  },
  mariadb: {
    'TINYINT': N,
    'SMALLINT': N,
    'MEDIUMINT': N,
    'INT': N,
    'BIGINT': N,
    'BIT': fraction(64),
    'FLOAT': N,
    'DOUBLE': N,
    'DECIMAL': { required: true, args: 2, max: 65, maxScale: 30, unboundedArgs: [38, 10] },
    'CHAR': len(255, 'VARCHAR'),
    'VARCHAR': len(16383, 'LONGTEXT'),
    'BINARY': len(255, 'VARBINARY'),
    'VARBINARY': len(65535, 'LONGBLOB'),
    'TINYTEXT': N,
    'TEXT': N,
    'MEDIUMTEXT': N,
    'LONGTEXT': N,
    'TINYBLOB': N,
    'BLOB': N,
    'MEDIUMBLOB': N,
    'LONGBLOB': N,
    'JSON': N,
    'ENUM': { required: true },
    'SET': { required: true },
    'DATE': N,
    'TIME': fraction(6),
    'DATETIME': fraction(6),
    'TIMESTAMP': fraction(6),
    'YEAR': N
  },
  mssql: {
    'TINYINT': N,
    'SMALLINT': N,
    'INT': N,
    'BIGINT': N,
    'BIT': N,
    'DECIMAL': { required: true, args: 2, max: 38, unboundedArgs: [38, 10] },
    'NUMERIC': { required: true, args: 2, max: 38, unboundedArgs: [38, 10] },
    'MONEY': N,
    'SMALLMONEY': N,
    'FLOAT': N,
    'REAL': N,
    'CHAR': len(8000, 'VARCHAR(MAX)'),
    'VARCHAR': len(8000, 'VARCHAR(MAX)', { allowMax: true }),
    'TEXT': N,
    'NCHAR': len(4000, 'NVARCHAR(MAX)'),
    'NVARCHAR': len(4000, 'NVARCHAR(MAX)', { allowMax: true }),
    'NTEXT': N,
    'BINARY': len(8000, 'VARBINARY(MAX)'),
    'VARBINARY': len(8000, 'VARBINARY(MAX)', { allowMax: true }),
    'IMAGE': N,
    'DATE': N,
    'TIME': fraction(7),
    'DATETIME': N,
    'DATETIME2': fraction(7),
    'SMALLDATETIME': N,
    'DATETIMEOFFSET': fraction(7),
    'UNIQUEIDENTIFIER': N,
    'XML': N,
    'ROWVERSION': N
  },
  postgresql: {
    'SMALLINT': N,
    'INTEGER': N,
    'BIGINT': N,
    'SMALLSERIAL': N,
    'SERIAL': N,
    'BIGSERIAL': N,
    'NUMERIC': { required: true, args: 2, max: 1000, unbounded: true },
    'REAL': N,
    'DOUBLE PRECISION': N,
    'MONEY': N,
    'BOOLEAN': N,
    'CHAR': len(10485760, 'TEXT'),
    'VARCHAR': len(10485760, 'TEXT', { unbounded: true }),
    'TEXT': N,
    'BYTEA': N,
    'BIT': { args: 1 },
    'VARBIT': { args: 1 },
    'DATE': N,
    'TIME': fraction(6),
    'TIMETZ': fraction(6),
    'TIMESTAMP': fraction(6),
    'TIMESTAMPTZ': fraction(6),
    'INTERVAL': N,
    'UUID': N,
    'JSON': N,
    'JSONB': N,
    'XML': N,
    'INET': N,
    'CIDR': N
  }
};

/** 같은 타입의 다른 이름. 변환표는 오른쪽 이름으로만 작성 */
const aliases: Record<DbmsType, Record<string, string>> = {
  oracle: {
    'VARCHAR': 'VARCHAR2', 'CHARACTER': 'CHAR', 'CHARACTER VARYING': 'VARCHAR2', 'INT': 'INTEGER', 'SMALLINT': 'INTEGER',
    'DEC': 'NUMBER', 'DECIMAL': 'NUMBER', 'NUMERIC': 'NUMBER', 'REAL': 'FLOAT', 'DOUBLE PRECISION': 'FLOAT'
  },
  mariadb: {
    'INTEGER': 'INT', 'INT1': 'TINYINT', 'INT2': 'SMALLINT', 'INT3': 'MEDIUMINT', 'INT4': 'INT', 'INT8': 'BIGINT',
    'BOOL': 'TINYINT(1)', 'BOOLEAN': 'TINYINT(1)', 'SERIAL': 'BIGINT UNSIGNED',
    'DEC': 'DECIMAL', 'NUMERIC': 'DECIMAL', 'FIXED': 'DECIMAL', 'REAL': 'DOUBLE', 'DOUBLE PRECISION': 'DOUBLE',
    'CHARACTER': 'CHAR', 'CHARACTER VARYING': 'VARCHAR', 'NCHAR': 'CHAR', 'NVARCHAR': 'VARCHAR', 'NATIONAL CHAR': 'CHAR', 'NATIONAL VARCHAR': 'VARCHAR'
  },
  mssql: {
    'INTEGER': 'INT', 'DEC': 'DECIMAL', 'DOUBLE PRECISION': 'FLOAT', 'CHARACTER': 'CHAR', 'CHARACTER VARYING': 'VARCHAR',
    'TIMESTAMP': 'ROWVERSION', 'SYSNAME': 'NVARCHAR(128)'
  },
  postgresql: {
    'INT': 'INTEGER', 'INT2': 'SMALLINT', 'INT4': 'INTEGER', 'INT8': 'BIGINT', 'SERIAL2': 'SMALLSERIAL', 'SERIAL4': 'SERIAL', 'SERIAL8': 'BIGSERIAL',
    'DECIMAL': 'NUMERIC', 'FLOAT4': 'REAL', 'FLOAT8': 'DOUBLE PRECISION', 'FLOAT': 'DOUBLE PRECISION', 'BOOL': 'BOOLEAN',
    'CHARACTER': 'CHAR', 'CHARACTER VARYING': 'VARCHAR', 'BIT VARYING': 'VARBIT',
    'TIMESTAMP WITHOUT TIME ZONE': 'TIMESTAMP', 'TIMESTAMP WITH TIME ZONE': 'TIMESTAMPTZ',
    'TIME WITHOUT TIME ZONE': 'TIME', 'TIME WITH TIME ZONE': 'TIMETZ'
  }
};

/** FLOAT(p): 단정밀도(p<=24) / 배정밀도 타입 */
const floatTypes: Record<DbmsType, [string, string]> = {
  oracle: ['BINARY_FLOAT', 'FLOAT'],
  mariadb: ['FLOAT', 'DOUBLE'],
  mssql: ['REAL', 'FLOAT'],
  postgresql: ['REAL', 'DOUBLE PRECISION']
};

/**
 * DBMS간 타입 변환표. 키는 별칭을 정리한 이름이며, 'NUMBER(10)'처럼 자릿수까지 쓴 키가 이름만 쓴 키보다 우선한다.
 * 값에 자릿수가 있으면 그대로 쓰고, 없으면 원래 자릿수를 대상 타입의 규칙(typeSpecs)에 맞추어 붙인다.
 */
const dataTypeMatch: Record<string, DataTypeMatch> = {
  postgresql2mariadb: {
    SMALLINT: 'SMALLINT',
    INTEGER: 'INT',
    BIGINT: 'BIGINT',
    SMALLSERIAL: 'SMALLINT',
    SERIAL: 'INT',
    BIGSERIAL: 'BIGINT',
    NUMERIC: 'DECIMAL',
    REAL: 'FLOAT',
    'DOUBLE PRECISION': 'DOUBLE',
    MONEY: 'DECIMAL(19,2)',
    BOOLEAN: 'TINYINT(1)',
    CHAR: 'CHAR',
    VARCHAR: 'VARCHAR',
    TEXT: 'LONGTEXT',
    BYTEA: 'LONGBLOB',
    BIT: 'BIT',
    VARBIT: 'BIT',
    DATE: 'DATE',
    TIME: 'TIME',
    TIMETZ: 'TIME',
    TIMESTAMP: 'DATETIME',
    TIMESTAMPTZ: 'TIMESTAMP',
    INTERVAL: 'VARCHAR(64)',
    UUID: 'CHAR(36)',
    JSON: 'JSON',
    JSONB: 'JSON',
    XML: 'LONGTEXT',
    INET: 'VARCHAR(43)',
    CIDR: 'VARCHAR(43)'
  },
  postgresql2oracle: {
    SMALLINT: 'NUMBER(5)',
    INTEGER: 'NUMBER(10)',
    BIGINT: 'NUMBER(19)',
    SMALLSERIAL: 'NUMBER(5)',
    SERIAL: 'NUMBER(10)',
    BIGSERIAL: 'NUMBER(19)',
    NUMERIC: 'NUMBER',
    REAL: 'BINARY_FLOAT',
    'DOUBLE PRECISION': 'BINARY_DOUBLE',
    MONEY: 'NUMBER(19,2)',
    BOOLEAN: 'NUMBER(1)',
    CHAR: 'CHAR',
    VARCHAR: 'VARCHAR2',
    TEXT: 'CLOB',
    BYTEA: 'BLOB',
    'BIT(1)': 'NUMBER(1)',
    BIT: 'VARCHAR2',
    VARBIT: 'VARCHAR2',
    DATE: 'DATE',
    TIME: 'DATE',
    TIMETZ: 'TIMESTAMP WITH TIME ZONE',
    TIMESTAMP: 'TIMESTAMP',
    TIMESTAMPTZ: 'TIMESTAMP WITH TIME ZONE',
    INTERVAL: 'INTERVAL DAY TO SECOND',
    UUID: 'CHAR(36)',
    JSON: 'CLOB',
    JSONB: 'CLOB',
    XML: 'XMLTYPE',
    INET: 'VARCHAR2(43)',
    CIDR: 'VARCHAR2(43)'
  },
  postgresql2mssql: {
    SMALLINT: 'SMALLINT',
    INTEGER: 'INT',
    BIGINT: 'BIGINT',
    SMALLSERIAL: 'SMALLINT',
    SERIAL: 'INT',
    BIGSERIAL: 'BIGINT',
    NUMERIC: 'NUMERIC',
    REAL: 'REAL',
    'DOUBLE PRECISION': 'FLOAT',
    MONEY: 'MONEY',
    BOOLEAN: 'BIT',
    CHAR: 'NCHAR',
    VARCHAR: 'NVARCHAR',
    TEXT: 'NVARCHAR(MAX)',
    BYTEA: 'VARBINARY(MAX)',
    'BIT(1)': 'BIT',
    BIT: 'VARCHAR',
    VARBIT: 'VARCHAR',
    DATE: 'DATE',
    TIME: 'TIME',
    TIMETZ: 'TIME',
    TIMESTAMP: 'DATETIME2',
    TIMESTAMPTZ: 'DATETIMEOFFSET',
    INTERVAL: 'VARCHAR(64)',
    UUID: 'UNIQUEIDENTIFIER',
    JSON: 'NVARCHAR(MAX)',
    JSONB: 'NVARCHAR(MAX)',
    XML: 'XML',
    INET: 'VARCHAR(43)',
    CIDR: 'VARCHAR(43)'
  },
  mariadb2postgresql: {
    TINYINT: 'SMALLINT',
    'TINYINT UNSIGNED': 'SMALLINT',
    'TINYINT(1)': 'BOOLEAN',
    SMALLINT: 'SMALLINT',
    'SMALLINT UNSIGNED': 'INTEGER',
    MEDIUMINT: 'INTEGER',
    'MEDIUMINT UNSIGNED': 'INTEGER',
    INT: 'INTEGER',
    'INT UNSIGNED': 'BIGINT',
    BIGINT: 'BIGINT',
    'BIGINT UNSIGNED': 'NUMERIC(20)',
    'BIT(1)': 'BOOLEAN',
    BIT: 'BIT',
    FLOAT: 'REAL',
    DOUBLE: 'DOUBLE PRECISION',
    DECIMAL: 'NUMERIC',
    CHAR: 'CHAR',
    VARCHAR: 'VARCHAR',
    BINARY: 'BYTEA',
    VARBINARY: 'BYTEA',
    TINYTEXT: 'TEXT',
    TEXT: 'TEXT',
    MEDIUMTEXT: 'TEXT',
    LONGTEXT: 'TEXT',
    TINYBLOB: 'BYTEA',
    BLOB: 'BYTEA',
    MEDIUMBLOB: 'BYTEA',
    LONGBLOB: 'BYTEA',
    JSON: 'JSONB',
    DATE: 'DATE',
    TIME: 'TIME',
    DATETIME: 'TIMESTAMP',
    TIMESTAMP: 'TIMESTAMPTZ',
    YEAR: 'SMALLINT',
    UUID: 'UUID'
  },
  oracle2postgresql: {
    'NUMBER(1)': 'BOOLEAN',
    'NUMBER(3)': 'SMALLINT',
    'NUMBER(5)': 'SMALLINT',
    'NUMBER(10)': 'INTEGER',
    'NUMBER(19)': 'BIGINT',
    NUMBER: 'NUMERIC',
    FLOAT: 'DOUBLE PRECISION',
    BINARY_FLOAT: 'REAL',
    BINARY_DOUBLE: 'DOUBLE PRECISION',
    INTEGER: 'INTEGER',
    BOOLEAN: 'BOOLEAN',
    CHAR: 'CHAR',
    NCHAR: 'CHAR',
    VARCHAR2: 'VARCHAR',
    NVARCHAR2: 'VARCHAR',
    RAW: 'BYTEA',
    'LONG RAW': 'BYTEA',
    LONG: 'TEXT',
    CLOB: 'TEXT',
    NCLOB: 'TEXT',
    BLOB: 'BYTEA',
    DATE: 'TIMESTAMP(0)',
    TIMESTAMP: 'TIMESTAMP',
    'TIMESTAMP WITH TIME ZONE': 'TIMESTAMPTZ',
    'TIMESTAMP WITH LOCAL TIME ZONE': 'TIMESTAMPTZ',
    'INTERVAL YEAR TO MONTH': 'INTERVAL',
    'INTERVAL DAY TO SECOND': 'INTERVAL',
    XMLTYPE: 'XML',
    JSON: 'JSONB',
    ROWID: 'VARCHAR(18)',
    UROWID: 'VARCHAR(4000)'
  },
  mssql2postgresql: {
    TINYINT: 'SMALLINT',
    SMALLINT: 'SMALLINT',
    INT: 'INTEGER',
    BIGINT: 'BIGINT',
    BIT: 'BOOLEAN',
    DECIMAL: 'NUMERIC',
    NUMERIC: 'NUMERIC',
    MONEY: 'NUMERIC(19,4)',
    SMALLMONEY: 'NUMERIC(10,4)',
    FLOAT: 'DOUBLE PRECISION',
    REAL: 'REAL',
    CHAR: 'CHAR',
    VARCHAR: 'VARCHAR',
    'VARCHAR(MAX)': 'TEXT',
    TEXT: 'TEXT',
    NCHAR: 'CHAR',
    NVARCHAR: 'VARCHAR',
    'NVARCHAR(MAX)': 'TEXT',
    NTEXT: 'TEXT',
    BINARY: 'BYTEA',
    VARBINARY: 'BYTEA',
    IMAGE: 'BYTEA',
    DATE: 'DATE',
    TIME: 'TIME',
    DATETIME: 'TIMESTAMP(3)',
    DATETIME2: 'TIMESTAMP',
    SMALLDATETIME: 'TIMESTAMP(0)',
    DATETIMEOFFSET: 'TIMESTAMPTZ',
    UNIQUEIDENTIFIER: 'UUID',
    XML: 'XML',
    ROWVERSION: 'BYTEA'
  },
  oracle2mariadb: {
    'NUMBER(1)': 'TINYINT(1)',
    'NUMBER(3)': 'SMALLINT',
    'NUMBER(5)': 'SMALLINT',
    'NUMBER(7)': 'MEDIUMINT',
    'NUMBER(10)': 'INT',
    'NUMBER(19)': 'BIGINT',
    NUMBER: 'DECIMAL',
    FLOAT: 'DOUBLE',
    BINARY_FLOAT: 'FLOAT',
    BINARY_DOUBLE: 'DOUBLE',
    INTEGER: 'INT',
    BOOLEAN: 'TINYINT(1)',
    CHAR: 'CHAR',
    NCHAR: 'CHAR',
    VARCHAR2: 'VARCHAR',
    NVARCHAR2: 'VARCHAR',
    RAW: 'VARBINARY',
    'LONG RAW': 'LONGBLOB',
    LONG: 'LONGTEXT',
    CLOB: 'LONGTEXT',
    NCLOB: 'LONGTEXT',
    BLOB: 'LONGBLOB',
    DATE: 'DATETIME',
    TIMESTAMP: 'DATETIME',
    'TIMESTAMP WITH TIME ZONE': 'TIMESTAMP',
    'TIMESTAMP WITH LOCAL TIME ZONE': 'TIMESTAMP',
    'INTERVAL YEAR TO MONTH': 'VARCHAR(64)',
    'INTERVAL DAY TO SECOND': 'VARCHAR(64)',
    XMLTYPE: 'LONGTEXT',
    JSON: 'JSON',
    ROWID: 'VARCHAR(18)',
    UROWID: 'VARCHAR(4000)'
  },
  oracle2mssql: {
    'NUMBER(1)': 'BIT',
    'NUMBER(3)': 'SMALLINT',
    'NUMBER(5)': 'SMALLINT',
    'NUMBER(10)': 'INT',
    'NUMBER(19)': 'BIGINT',
    NUMBER: 'DECIMAL',
    FLOAT: 'FLOAT',
    BINARY_FLOAT: 'REAL',
    BINARY_DOUBLE: 'FLOAT',
    INTEGER: 'NUMERIC(38)',
    BOOLEAN: 'BIT',
    CHAR: 'CHAR',
    NCHAR: 'NCHAR',
    VARCHAR2: 'VARCHAR',
    NVARCHAR2: 'NVARCHAR',
    RAW: 'VARBINARY',
    'LONG RAW': 'VARBINARY(MAX)',
    LONG: 'VARCHAR(MAX)',
    CLOB: 'VARCHAR(MAX)',
    NCLOB: 'NVARCHAR(MAX)',
    BLOB: 'VARBINARY(MAX)',
    DATE: 'DATETIME',
    TIMESTAMP: 'DATETIME2',
    'TIMESTAMP WITH TIME ZONE': 'DATETIMEOFFSET',
    'TIMESTAMP WITH LOCAL TIME ZONE': 'DATETIMEOFFSET',
    'INTERVAL YEAR TO MONTH': 'VARCHAR(64)',
    'INTERVAL DAY TO SECOND': 'VARCHAR(64)',
    XMLTYPE: 'XML',
    JSON: 'NVARCHAR(MAX)',
    ROWID: 'VARCHAR(18)',
    UROWID: 'VARCHAR(4000)'
  },
  mariadb2oracle: {
    TINYINT: 'NUMBER(3)',
    'TINYINT UNSIGNED': 'NUMBER(3)',
    'TINYINT(1)': 'NUMBER(1)',
    SMALLINT: 'NUMBER(5)',
    'SMALLINT UNSIGNED': 'NUMBER(5)',
    MEDIUMINT: 'NUMBER(7)',
    'MEDIUMINT UNSIGNED': 'NUMBER(8)',
    INT: 'NUMBER(10)',
    'INT UNSIGNED': 'NUMBER(10)',
    BIGINT: 'NUMBER(19)',
    'BIGINT UNSIGNED': 'NUMBER(20)',
    'BIT(1)': 'NUMBER(1)',
    BIT: 'VARCHAR2',
    FLOAT: 'BINARY_FLOAT',
    DOUBLE: 'BINARY_DOUBLE',
    DECIMAL: 'NUMBER',
    CHAR: 'CHAR',
    VARCHAR: 'VARCHAR2',
    BINARY: 'RAW',
    VARBINARY: 'RAW',
    TINYTEXT: 'VARCHAR2(255)',
    TEXT: 'CLOB',
    MEDIUMTEXT: 'CLOB',
    LONGTEXT: 'CLOB',
    TINYBLOB: 'RAW(255)',
    BLOB: 'BLOB',
    MEDIUMBLOB: 'BLOB',
    LONGBLOB: 'BLOB',
    JSON: 'CLOB',
    DATE: 'DATE',
    TIME: 'DATE',
    'DATETIME(3)': 'TIMESTAMP(3)',
    'DATETIME(6)': 'TIMESTAMP(6)',
    DATETIME: 'DATE',
    TIMESTAMP: 'TIMESTAMP',
    YEAR: 'NUMBER(4)',
    UUID: 'CHAR(36)'
  },
  mariadb2mssql: {
    TINYINT: 'SMALLINT',
    'TINYINT UNSIGNED': 'TINYINT',
    'TINYINT(1)': 'BIT',
    SMALLINT: 'SMALLINT',
    'SMALLINT UNSIGNED': 'INT',
    MEDIUMINT: 'INT',
    'MEDIUMINT UNSIGNED': 'INT',
    INT: 'INT',
    'INT UNSIGNED': 'BIGINT',
    BIGINT: 'BIGINT',
    'BIGINT UNSIGNED': 'NUMERIC(20)',
    'BIT(1)': 'BIT',
    BIT: 'VARCHAR',
    FLOAT: 'REAL',
    DOUBLE: 'FLOAT',
    DECIMAL: 'DECIMAL',
    CHAR: 'NCHAR',
    VARCHAR: 'NVARCHAR',
    BINARY: 'BINARY',
    VARBINARY: 'VARBINARY',
    TINYTEXT: 'NVARCHAR(255)',
    TEXT: 'NVARCHAR(MAX)',
    MEDIUMTEXT: 'NVARCHAR(MAX)',
    LONGTEXT: 'NVARCHAR(MAX)',
    TINYBLOB: 'VARBINARY(255)',
    BLOB: 'VARBINARY(MAX)',
    MEDIUMBLOB: 'VARBINARY(MAX)',
    LONGBLOB: 'VARBINARY(MAX)',
    JSON: 'NVARCHAR(MAX)',
    DATE: 'DATE',
    TIME: 'TIME',
    DATETIME: 'DATETIME2',
    TIMESTAMP: 'DATETIME2',
    YEAR: 'SMALLINT',
    UUID: 'UNIQUEIDENTIFIER'
  },
  mssql2oracle: {
    TINYINT: 'NUMBER(3)',
    SMALLINT: 'NUMBER(5)',
    INT: 'NUMBER(10)',
    BIGINT: 'NUMBER(19)',
    BIT: 'NUMBER(1)',
    DECIMAL: 'NUMBER',
    NUMERIC: 'NUMBER',
    MONEY: 'NUMBER(19,4)',
    SMALLMONEY: 'NUMBER(10,4)',
    FLOAT: 'BINARY_DOUBLE',
    REAL: 'BINARY_FLOAT',
    CHAR: 'CHAR',
    VARCHAR: 'VARCHAR2',
    'VARCHAR(MAX)': 'CLOB',
    TEXT: 'CLOB',
    NCHAR: 'NCHAR',
    NVARCHAR: 'NVARCHAR2',
    'NVARCHAR(MAX)': 'NCLOB',
    NTEXT: 'NCLOB',
    BINARY: 'RAW',
    VARBINARY: 'RAW',
    'VARBINARY(MAX)': 'BLOB',
    IMAGE: 'BLOB',
    DATE: 'DATE',
    TIME: 'TIMESTAMP',
    DATETIME: 'TIMESTAMP(3)',
    DATETIME2: 'TIMESTAMP',
    SMALLDATETIME: 'DATE',
    DATETIMEOFFSET: 'TIMESTAMP WITH TIME ZONE',
    UNIQUEIDENTIFIER: 'CHAR(36)',
    XML: 'XMLTYPE',
    ROWVERSION: 'RAW(8)'
  },
  mssql2mariadb: {
    TINYINT: 'TINYINT UNSIGNED',
    SMALLINT: 'SMALLINT',
    INT: 'INT',
    BIGINT: 'BIGINT',
    BIT: 'TINYINT(1)',
    DECIMAL: 'DECIMAL',
    NUMERIC: 'DECIMAL',
    MONEY: 'DECIMAL(19,4)',
    SMALLMONEY: 'DECIMAL(10,4)',
    FLOAT: 'DOUBLE',
    REAL: 'FLOAT',
    CHAR: 'CHAR',
    VARCHAR: 'VARCHAR',
    'VARCHAR(MAX)': 'LONGTEXT',
    TEXT: 'LONGTEXT',
    NCHAR: 'CHAR',
    NVARCHAR: 'VARCHAR',
    'NVARCHAR(MAX)': 'LONGTEXT',
    NTEXT: 'LONGTEXT',
    BINARY: 'BINARY',
    VARBINARY: 'VARBINARY',
    'VARBINARY(MAX)': 'LONGBLOB',
    IMAGE: 'LONGBLOB',
    DATE: 'DATE',
    TIME: 'TIME',
    DATETIME: 'DATETIME(3)',
    DATETIME2: 'DATETIME',
    SMALLDATETIME: 'DATETIME',
    DATETIMEOFFSET: 'TIMESTAMP',
    UNIQUEIDENTIFIER: 'CHAR(36)',
    XML: 'LONGTEXT',
    ROWVERSION: 'BINARY(8)'
  },
};

/** 타입을 이름, 자릿수, UNSIGNED로 나눔. TIMESTAMP(6) WITH TIME ZONE -> TIMESTAMP WITH TIME ZONE, ["6"] */
interface ParsedType { name: string; args: string[]; unsigned: boolean }

function parseType(dataType: string): ParsedType {
  const text = dataType.trim().toUpperCase().replace(/\s+/g, " ");
  const group = text.match(/\(([^()]*)\)/);
  // VARCHAR2(10 CHAR) -> 10
  const args = group ? group[1].split(",").map(arg => arg.trim().replace(/ (CHAR|BYTE)$/, "")).filter(Boolean) : [];
  const words = text.replace(/\([^()]*\)/g, " ").split(" ").filter(Boolean);
  const unsigned = words.includes("UNSIGNED");
  const name = words.filter(word => !["UNSIGNED", "SIGNED", "ZEROFILL"].includes(word)).join(" ");
  return { name, args, unsigned };
}

/** 원본 DBMS 안에서 같은 의미의 표준 이름으로 정리 (별칭, ENUM, FLOAT(p)) */
function normalizeType(type: ParsedType, dataType: string, sourceDB: DbmsType): ParsedType {
  // ENUM('A','BB') -> VARCHAR(2), SET('A','BB') -> VARCHAR(4): 가장 긴 값(SET은 모두 이은 값)이 들어갈 길이
  if (sourceDB === "mariadb" && (type.name === "ENUM" || type.name === "SET")) {
    const values = [...dataType.matchAll(/'((?:[^']|'')*)'/g)].map(m => m[1].replace(/''/g, "'").length);
    const size = type.name === "ENUM" ? Math.max(1, ...values) : Math.max(1, values.reduce((sum, n) => sum + n + 1, -1));
    return { name: "VARCHAR", args: [String(size)], unsigned: false };
  }
  const float = type.name === "FLOAT" && type.args.length === 1 ? Number(type.args[0]) : NaN;
  if (Number.isInteger(float)) return { name: floatTypes[sourceDB][float <= 24 ? 0 : 1], args: [], unsigned: type.unsigned };
  // BIT = BIT(1) (MSSQL BIT는 자릿수 없는 타입)
  if (type.name === "BIT" && !type.args.length && sourceDB !== "mssql") return { ...type, args: ["1"] };
  const alias = aliases[sourceDB][type.name];
  if (!alias) return type;
  const target = parseType(alias);
  return { name: target.name, args: target.args.length ? target.args : type.args, unsigned: type.unsigned || target.unsigned };
}

/** 변환표에서 찾음. 자릿수까지 쓴 키(NUMBER(10), VARCHAR(MAX))가 먼저. 자릿수까지 맞으면 exact */
function lookup(table: DataTypeMatch, type: ParsedType): { value: string; exact: boolean } | undefined {
  const names = type.unsigned ? [type.name + " UNSIGNED", type.name] : [type.name];
  for (const name of names) {
    if (type.args.length) {
      const keys = [`${name}(${type.args.join(",")})`];
      // NUMBER(10,0) = NUMBER(10)
      if (type.args.length === 2 && type.args[1] === "0") keys.push(`${name}(${type.args[0]})`);
      for (const key of keys) if (key in table) return { value: table[key], exact: true };
    }
    if (name in table) return { value: table[name], exact: false };
  }
  return undefined;
}

/** 자릿수를 붙임. TIMESTAMP WITH TIME ZONE은 TIMESTAMP 바로 뒤에 */
function withArgs(name: string, args: (string | number)[]): string {
  if (!args.length) return name;
  const pos = name.indexOf(" WITH ");
  const text = `(${args.join(",")})`;
  return pos < 0 ? name + text : name.slice(0, pos) + text + name.slice(pos);
}

/** 원래 자릿수를 대상 타입의 규칙에 맞추어 붙임 */
function applyArgs(name: string, args: string[], unbounded: boolean, targetDB: DbmsType, depth = 0): string {
  if (name.includes("(")) return name;
  const spec = typeSpecs[targetDB][name.replace(/ UNSIGNED$/, "")];
  if (!spec) return withArgs(name, args);
  const next = (type: string, nextArgs: string[]) => depth < 3 ? applyArgs(type, nextArgs, unbounded, targetDB, depth + 1) : type;

  if (!args.length) {
    // 범위 제한이 없는 원본(Oracle NUMBER, PostgreSQL VARCHAR): 기본 자릿수로는 값이 잘리므로 넉넉한 자릿수나 큰 타입으로
    if (unbounded && spec.unboundedArgs) return withArgs(name, spec.unboundedArgs);
    if (unbounded && spec.required && spec.big) return next(spec.big, []);
    return name;
  }
  if (!spec.args) return name;
  if (args[0] === "MAX") {
    if (spec.allowMax) return name + "(MAX)";
    return spec.big ? next(spec.big, []) : name;
  }
  const nums = args.slice(0, spec.args).map(Number);
  if (nums.some(n => !Number.isInteger(n))) return name;
  if (spec.max !== undefined && nums[0] > spec.max) {
    if (spec.big) return next(spec.big, args);
    nums[0] = spec.max;
  }
  if (nums.length > 1) nums[1] = Math.max(0, Math.min(nums[1], nums[0], spec.maxScale ?? nums[1]));
  return withArgs(name, nums);
}

export const dataTypeUtil = {
  /** 입력 도우미용 DBMS별 타입 목록 */
  getDataTypes(dbms: DbmsType): DataTypeList {
    const list: DataTypeList = {};
    for (const [name, spec] of Object.entries(typeSpecs[dbms] ?? {})) list[name] = spec.required ? "Y" : "N";
    return list;
  },

  /** 두 DBMS간 변환표가 있는지 */
  canConvert(sourceDB: DbmsType, targetDB: DbmsType): boolean {
    return sourceDB === targetDB || (sourceDB + "2" + targetDB) in dataTypeMatch;
  },

  /**
   * 다른 DBMS의 타입으로 변환. VARCHAR(10) -> VARCHAR2(10), INT(11) -> NUMBER(10), VARCHAR(MAX) -> TEXT.
   * 대응하는 타입이 없으면 그대로 두고, unmapped가 있으면 원래 타입을 추가.
   */
  convertDataType(dataType: string, sourceDB: DbmsType, targetDB: DbmsType, unmapped?: Set<string>): string {
    if (sourceDB === targetDB || !dataType?.trim()) return dataType;
    const table = dataTypeMatch[sourceDB + "2" + targetDB];
    const type = normalizeType(parseType(dataType), dataType, sourceDB);
    const found = table && type.name ? lookup(table, type) : undefined;
    if (!found) {
      unmapped?.add(dataType.trim());
      return dataType;
    }
    if (found.exact) return found.value;
    const unbounded = !type.args.length && !!typeSpecs[sourceDB][type.name]?.unbounded;
    return applyArgs(found.value, type.args, unbounded, targetDB);
  }
};
