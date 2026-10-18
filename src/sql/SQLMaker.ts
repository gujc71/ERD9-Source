import type { DbmsType, ReferentialAction } from "../constants";
import type { Relation9 } from "../diagram/Relation9";
import { state } from "../state";
import type { AnyDiagram } from "../state";
import type { CheckData, EntityData, FieldData, IndexData, RelationFieldInfo, SequenceObject, ViewObject } from "../types";
import { diagramUtil } from "../util/diagramUtil";

/** Map(entityMap) 또는 배열(선택 목록) 모두 values()로 순회 */
export type DiagramCollection<T> = { values(): Iterable<T> };

/** DDL에 함께 출력할 문서 단위 객체 */
export interface DocObjects {
	views: ViewObject[];
	sequences: SequenceObject[];
}

export const sqlMakerManager = {
	getMaker (dbms: DbmsType = state.dbmsType): SQLMaker {
		switch (dbms) {
			case "oracle": 	   return new OracleMaker();
			case "mssql":  	   return new MsSqlMaker();
			case "postgresql": return new PostgreSqlMaker();
		}
		return new MariaDBMaker();
	},
	makeSQL (editor: HTMLElement, tableList: DiagramCollection<AnyDiagram>, relationList?: DiagramCollection<Relation9>, objects?: DocObjects): void {
		this.getMaker().makeSQL(editor, tableList, relationList, objects);
	},
	getSQL(tableList: AnyDiagram[]): string {
		return this.getMaker().getSQL(tableList);
	},
	getAllSQL(tableList: DiagramCollection<AnyDiagram>, relationList?: DiagramCollection<Relation9>, objects?: DocObjects): string {
		return this.getMaker().getAllSQL(tableList, relationList, objects);
	},
	/** 선택된 엔터티들 사이의 관계만 (양쪽 엔터티가 모두 선택된 관계). 순서: 엔터티 순서대로 자식 관계, 부모 관계 */
	getUsedRelationList(tableList: DiagramCollection<AnyDiagram>): Relation9[] {
		const tableIDs = new Set<string>();  // 선택된 테이블만 관계를 찾기 위해
		for (const table of tableList.values()) {
			tableIDs.add(table.id);
		}
		const relations = new Set<Relation9>();	// 삽입 순서 유지, 중복 제거
		for (const table of tableList.values()) {
			if (!("myChildList" in table)) continue;
			for (const value of table.myChildList) {
				if (tableIDs.has(value.childEntity.id)) relations.add(value);
			}
			for (const value of table.myParentList) {
				if (tableIDs.has(value.parentEntity.id)) relations.add(value);
			}
		}
		return [...relations];
	}
};

/** 엔터티(Entity9)의 테이블 정보만 추출. 텍스트, 주제 영역은 제외 */
function getTableData(diagram: AnyDiagram): EntityData | undefined {
	const data = (diagram as { data?: unknown }).data;
	return data && typeof data === "object" && "physicalName" in data ? data as EntityData : undefined;
}

/** keys + fields (allFields가 없는 순수 데이터도 처리) */
export function getAllFields(tableData: EntityData): FieldData[] {
	return tableData.allFields ?? tableData.keys.concat(tableData.fields);
}

/* -----------------------------------------------------------------------------------
 * 생성되는 SQL에 다른 구문이 끼어들지 않도록 값 정리 (가져온 파일, AI 응답의 값도 그대로 출력되므로)
 */
const PLAIN_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_$#]*$/;
/**
 * 데이터 타입: VARCHAR(10), NUMBER(3,0), DOUBLE PRECISION, VARCHAR(MAX), FLOAT (24), VARCHAR2(10 CHAR),
 * ENUM('A','B'), TIMESTAMP(6) WITH TIME ZONE, INT(11) UNSIGNED, INTEGER[] 등
 */
const TYPE_ARG = String.raw`(?:[A-Za-z0-9_]+(?:\s+(?:CHAR|BYTE))?|'(?:[^']|'')*')`;
const DATA_TYPE = new RegExp(String.raw`^[A-Za-z][A-Za-z0-9_ ]*(\s*\(\s*${TYPE_ARG}(\s*,\s*${TYPE_ARG})*\s*\))?(\s+[A-Za-z][A-Za-z0-9_ ]*)?(\[\])*`, "i");
/** 그대로 쓸 수 있는 기본값: 숫자, 키워드/함수(CURRENT_TIMESTAMP, NOW(), NULL), 따옴표로 감싼 문자열 */
const DEFAULT_NUMBER = /^[+-]?\d+(\.\d+)?$/;
const DEFAULT_KEYWORD = /^[A-Za-z_][A-Za-z0-9_]*(\(\))?$/;
const DEFAULT_STRING = /^N?'(?:[^']|'')*'$/;

/** 문자열 리터럴 안에 넣을 값: 작은따옴표를 두 번. MariaDB는 역슬래시도 이스케이프 문자이므로 함께 처리 */
export function sqlString(value: string | number | undefined, escapeBackslash = false): string {
	const text = String(value ?? "");
	return (escapeBackslash ? text.replace(/\\/g, "\\\\") : text).replace(/'/g, "''");
}

export function sqlDataType(dataType: string): string {
	return dataType.trim().match(DATA_TYPE)?.[0].trim() || "UNKNOWN";
}

function sqlDefault(value: string | number, escapeBackslash: boolean): string {
	const text = String(value).trim();
	if (DEFAULT_NUMBER.test(text) || DEFAULT_KEYWORD.test(text)) return text;
	if (DEFAULT_STRING.test(text) && !(escapeBackslash && text.includes("\\"))) return text;
	return `'${sqlString(text, escapeBackslash)}'`;
}

/**
 * 사용자가 입력한 SQL 조각(CHECK 조건식, 뷰 쿼리)이 하나의 구문인지 확인.
 * 따옴표 밖의 세미콜론과 주석, 짝이 맞지 않는 괄호가 있으면 다른 구문이 끼어들 수 있으므로 거부한다.
 */
export function isSingleExpression(sql: string): boolean {
	let depth = 0;
	for (let i = 0; i < sql.length; i++) {
		const ch = sql[i];
		if (ch === "'" || ch === '"' || ch === "`") {
			const end = sql.indexOf(ch, i + 1);
			if (end === -1) return false;
			i = end;
			continue;
		}
		if (ch === ";") return false;
		if ((ch === "-" && sql[i + 1] === "-") || (ch === "/" && sql[i + 1] === "*")) return false;
		if (ch === "(") depth++;
		if (ch === ")" && --depth < 0) return false;
	}
	return depth === 0;
}

/** 한 줄 SQL 주석 (줄바꿈 제거) */
function lineComment(text: string): string {
	return `-- ${text.replace(/[\r\n]+/g, " ")}\n`;
}

/** 정수 (시퀀스 옵션) */
function int(value: number | undefined): string | undefined {
	return value === undefined || !Number.isFinite(value) ? undefined : String(Math.trunc(value));
}

export abstract class SQLMaker {
  /** 문자열 안의 역슬래시가 이스케이프 문자인 DBMS (MariaDB) */
  protected escapeBackslash = false;
  /** 지원하는 참조 동작. 지원하지 않는 값은 주석으로 남긴다 */
  protected onDeleteActions: readonly ReferentialAction[] = ["CASCADE", "SET NULL", "SET DEFAULT", "RESTRICT"];
  protected onUpdateActions: readonly ReferentialAction[] = ["CASCADE", "SET NULL", "SET DEFAULT", "RESTRICT"];

  // HTML format. 구문(테이블)마다 <pre>로 출력하되, 한 번에 만들어 DOM에 한 번만 추가
  makeSQL(editor: HTMLElement, tableList: DiagramCollection<AnyDiagram>, relationList?: DiagramCollection<Relation9>, objects?: DocObjects): void {
	const fragment = document.createDocumentFragment();
	const print = (sql: string) => {
		if (sql) diagramUtil.createHTMLElement(fragment, "pre", "log-span", sql);
	};
	for (const sql of this.makeSequences(objects)) print(sql);
	for (const value of tableList.values()) {
		print(this.makeTable(getTableData(value)));
	}
	for (const relationData of relationList?.values() ?? []) {
		print(this.makeAlterSQL(relationData));
	}
	for (const sql of this.makeViews(objects)) print(sql);
	editor.appendChild(fragment);
	editor.scrollTop = editor.scrollHeight;
  }
  // just sql selected
  getSQL(tableList: AnyDiagram[]): string {
	return this.getAllSQL(tableList, sqlMakerManager.getUsedRelationList(tableList));
  }

  // just sql all tables
  getAllSQL(tableList: DiagramCollection<AnyDiagram>, relationList?: DiagramCollection<Relation9>, objects?: DocObjects): string {
	let sql = this.makeSequences(objects).join("");
	for (const value of tableList.values()) {
		sql += this.makeTable(getTableData(value));
	}
	for (const relationData of relationList?.values() ?? []) {
		sql += this.makeAlterSQL(relationData);
    }
	return sql + this.makeViews(objects).join("");
  }

  private makeSequences(objects?: DocObjects): string[] {
	return objects?.sequences.map(seq => this.makeSequence(seq)) ?? [];
  }
  private makeViews(objects?: DocObjects): string[] {
	return objects?.views.map(view => this.makeView(view)) ?? [];
  }

  makeAlterSQL(relationData: Relation9): string {
	return this.makeForeignKey(relationData.name || relationData.id, relationData.getRelationData(), relationData.onDelete, relationData.onUpdate);
  }

  makeForeignKey(name: string, data: RelationFieldInfo, onDelete?: ReferentialAction, onUpdate?: ReferentialAction): string {
	const actions = this.referentialAction("DELETE", onDelete, this.onDeleteActions) + this.referentialAction("UPDATE", onUpdate, this.onUpdateActions);
	return `ALTER TABLE ${this.id(data.childTable)} ADD CONSTRAINT ${this.id(name)} FOREIGN KEY ( ${this.idList(data.childFields)} ) REFERENCES ${this.id(data.parentTable)} ( ${this.idList(data.parentFields)} )${actions};\n`;
  }

  /** NO ACTION은 모든 DBMS의 기본값이므로 생략 */
  protected referentialAction(event: "DELETE" | "UPDATE", action: ReferentialAction | undefined, supported: readonly ReferentialAction[]): string {
	if (!action || action === "NO ACTION") return "";
	if (!supported.includes(action)) return ` /* ON ${event} ${action} is not supported */`;
	return ` ON ${event} ${action}`;
  }

  /** 컬럼 정의. unique: UNIQUE 출력 여부 (ALTER로 컬럼을 수정할 때는 유니크 인덱스가 중복 생성되지 않도록 제외) */
  columnDefinition(columnData: FieldData, unique = true): string {
	let columnStr = `${this.id(columnData.column)}    ${sqlDataType(columnData.dataType)}`;
	if (columnData.notNull) 	 columnStr += "    NOT NULL";
	if (columnData.ai) 			 columnStr += this.makeColumnAI();
	if (columnData.defaultValue !== undefined && columnData.defaultValue !== "") columnStr += "    DEFAULT " + this.sqlDefault(columnData.defaultValue);
	if (unique && columnData.uniqueKey) columnStr += " UNIQUE";
	if (columnData.comment) columnStr += this.makeColumnCommentInColumn(columnData.comment);		// MariaDB
	return columnStr;
  }

  sqlDefault(value: string | number): string {
	return sqlDefault(value, this.escapeBackslash);
  }

  makeTable(tableData?: EntityData): string {
	if (!tableData) return "";
	const allFields = getAllFields(tableData);
	const pkList: string[] = [];
	const columnSQLs: string[]  = [];
	const commentSQLs: string[] = [];
	allFields.forEach((columnData) => {
		if (columnData.comment) commentSQLs.push(this.makeColumnComment(tableData.physicalName, columnData));  // Oracle, MS-SQL, PostgreSQL
	    if (columnData.isPK) pkList.push(columnData.column);

		columnSQLs.push("    " + this.columnDefinition(columnData));
	});

	if (pkList.length>0)  columnSQLs.push("    " + this.makePrimaryKeyConstraint(tableData.physicalName, pkList));
	for (const check of tableData.checks ?? []) {
		columnSQLs.push("    " + this.makeCheckConstraint(check));
	}

	let tableSQL = this.makeCreateTable(tableData.physicalName);
	tableSQL += columnSQLs.join(",\n");
	tableSQL += "\n) " + this.makeTableComment4Tail(tableData.logicalName) + ";\n";	  		// MariaDB
	if (tableData.logicalName && tableData.logicalName!==tableData.physicalName) {
		tableSQL += this.makeTableComment(tableData);									// Oracle, MS-SQL, PostgreSQL
	}
	tableSQL += commentSQLs.join("");
	tableSQL += this.makeIndex(tableData.physicalName, tableData.indexes);

	return tableSQL;
  }

  /** 식별자(테이블, 컬럼, 제약조건명). 일반적인 이름이 아니면 DBMS 방식으로 따옴표 처리 */
  id(name: string): string {
	const trimmed = name.trim();
	return PLAIN_IDENTIFIER.test(trimmed) ? trimmed : this.quoteIdentifier(trimmed);
  }
  /** 콤마로 구분된 컬럼 목록 */
  idList(names: string): string {
	return names.split(",").map(name => this.id(name)).join(",");
  }
  quoteIdentifier(name: string): string {
	return `"${name.replace(/"/g, '""')}"`;
  }

  makeCreateTable(tableName: string): string {
	  return `CREATE TABLE ${this.id(tableName)} (\n`;
  }

  // DBMS 별로 필요한 함수를 orerride해서 사용
  abstract makeColumnAI(): string;
  makeTableComment(_tableData: EntityData): string {return "";}   				// 테이블 생성과 관계없이 독립적으로 주석 생성 - Oracle, MS-SQL, PostgreSQL
  makeTableComment4Tail(_comment?: string): string {return "";}  				// 테이블 생성시 주석을 추가 - MariaDB
  makeColumnComment(_tableName: string, _columnData: FieldData): string {return "";}     // 컬럼 생성과 관계없이 독립적으로 주석 생성 - Oracle, MS-SQL, PostgreSQL
  makeColumnCommentInColumn(_comment: string): string {return "";}   		// 컬럼 생성시 주석을 추가 - MariaDB

  primaryKeyName(tableName: string): string {
	return "PK_" + tableName;
  }
  makePrimaryKeyConstraint(tableName: string, fields: string[]): string {
	  return `CONSTRAINT  ${this.id(this.primaryKeyName(tableName))}  PRIMARY KEY (${fields.map(field => this.id(field)).join(",")})`;
  }

  makeCheckConstraint(check: CheckData): string {
	const expression = check.expression.trim();
	if (!isSingleExpression(expression)) return `/* CHECK ${check.name}: the expression must be a single expression without semicolons or comments */`;
	return `CONSTRAINT ${this.id(check.name)} CHECK (${expression})`;
  }

  makeIndex(tableName: string, indexesData?: IndexData[]): string {
	return (indexesData ?? []).map(index => this.makeIndexSQL(tableName, index)).join("");
  }
  makeIndexSQL(tableName: string, index: IndexData): string {
	return `CREATE ${index.unique ? "UNIQUE " : ""}INDEX ${this.id(index.name)} ON ${this.id(tableName)} (${this.idList(index.fields)});\n`;
  }

  makeView(view: ViewObject, replace = false): string {
	const query = view.query.trim().replace(/;+\s*$/, "");
	if (!isSingleExpression(query)) return lineComment(`VIEW ${view.name}: the query must be a single statement without semicolons or comments`);
	const comment = view.comment ? lineComment(view.comment) : "";
	return `${comment}${this.createView(replace)} ${this.id(view.name)} AS\n${query};\n`;
  }
  protected createView(replace: boolean): string {
	return replace ? "CREATE OR REPLACE VIEW" : "CREATE VIEW";
  }

  makeSequence(seq: SequenceObject): string {
	const options: string[] = [];
	const start = int(seq.start), increment = int(seq.increment), minValue = int(seq.minValue), maxValue = int(seq.maxValue);
	if (start !== undefined) options.push("START WITH " + start);
	if (increment !== undefined) options.push("INCREMENT BY " + increment);
	if (minValue !== undefined) options.push("MINVALUE " + minValue);
	if (maxValue !== undefined) options.push("MAXVALUE " + maxValue);
	if (seq.cycle) options.push("CYCLE");
	return `CREATE SEQUENCE ${this.id(seq.name)}${this.sequenceType()}${options.length ? " " + options.join(" ") : ""};\n`;
  }
  protected sequenceType(): string {
	return "";
  }

  /* -----------------------------------------------------------------------------------
   * ALTER (ERD 비교 결과를 반영하는 스크립트)
   */
  dropTable(tableName: string): string {
	return `DROP TABLE ${this.id(tableName)};\n`;
  }
  renameTable(oldName: string, newName: string): string {
	return `ALTER TABLE ${this.id(oldName)} RENAME TO ${this.id(newName)};\n`;
  }
  addColumn(tableName: string, field: FieldData): string {
	return `ALTER TABLE ${this.id(tableName)} ADD ${this.columnDefinition(field)};\n`;
  }
  dropColumn(tableName: string, column: string): string {
	return `ALTER TABLE ${this.id(tableName)} DROP COLUMN ${this.id(column)};\n`;
  }
  renameColumn(tableName: string, oldName: string, newName: string): string {
	return `ALTER TABLE ${this.id(tableName)} RENAME COLUMN ${this.id(oldName)} TO ${this.id(newName)};\n`;
  }
  /** 타입, NOT NULL, 기본값 변경. (컬럼명은 이미 newField로 바뀐 상태) */
  abstract modifyColumn(tableName: string, oldField: FieldData, newField: FieldData): string;

  /** 컬럼 주석 변경 (MariaDB는 modifyColumn에 포함) */
  changeColumnComment(tableName: string, _oldField: FieldData, newField: FieldData): string {
	return this.makeColumnComment(tableName, { ...newField, comment: newField.comment ?? "" });
  }
  changeTableComment(tableData: EntityData, _oldComment?: string): string {
	return this.makeTableComment({ ...tableData, logicalName: tableData.logicalName ?? "" });
  }

  addUnique(tableName: string, column: string): string {
	return `ALTER TABLE ${this.id(tableName)} ADD UNIQUE (${this.id(column)});\n`;
  }
  dropPrimaryKey(tableName: string, pkTableName: string): string {
	return `ALTER TABLE ${this.id(tableName)} DROP CONSTRAINT ${this.id(this.primaryKeyName(pkTableName))};\n`;
  }
  addPrimaryKey(tableName: string, fields: string[]): string {
	return `ALTER TABLE ${this.id(tableName)} ADD ${this.makePrimaryKeyConstraint(tableName, fields)};\n`;
  }
  addCheck(tableName: string, check: CheckData): string {
	return `ALTER TABLE ${this.id(tableName)} ADD ${this.makeCheckConstraint(check)};\n`;
  }
  dropConstraint(tableName: string, name: string): string {
	return `ALTER TABLE ${this.id(tableName)} DROP CONSTRAINT ${this.id(name)};\n`;
  }
  dropForeignKey(tableName: string, name: string): string {
	return this.dropConstraint(tableName, name);
  }
  dropIndex(_tableName: string, indexName: string): string {
	return `DROP INDEX ${this.id(indexName)};\n`;
  }
  dropView(name: string): string {
	return `DROP VIEW ${this.id(name)};\n`;
  }
  dropSequence(name: string): string {
	return `DROP SEQUENCE ${this.id(name)};\n`;
  }
}

class OracleMaker extends SQLMaker{
  protected override onDeleteActions: readonly ReferentialAction[] = ["CASCADE", "SET NULL"];
  protected override onUpdateActions: readonly ReferentialAction[] = [];

  override makeTableComment(tableData: EntityData): string {
	  return `COMMENT ON TABLE ${this.id(tableData.physicalName)} IS '${sqlString(tableData.logicalName)}';\n`;
  }
  makeColumnAI(): string {
	return " GENERATED BY DEFAULT AS IDENTITY";
  }
  override makeColumnComment(tableName: string, columnData: FieldData): string {
	  return `COMMENT ON COLUMN ${this.id(tableName)}.${this.id(columnData.column)} IS '${sqlString(columnData.comment)}';\n`;
  }
  override addColumn(tableName: string, field: FieldData): string {
	return `ALTER TABLE ${this.id(tableName)} ADD (${this.columnDefinition(field)});\n`;
  }
  modifyColumn(tableName: string, oldField: FieldData, newField: FieldData): string {
	let def = `${this.id(newField.column)} ${sqlDataType(newField.dataType)}`;
	if (oldField.defaultValue !== newField.defaultValue) def += " DEFAULT " + (newField.defaultValue === undefined || newField.defaultValue === "" ? "NULL" : this.sqlDefault(newField.defaultValue));
	// 이미 같은 상태로 바꾸면 오류(ORA-01442)이므로 바뀐 경우만
	if (!!oldField.notNull !== !!newField.notNull) def += newField.notNull ? " NOT NULL" : " NULL";
	return `ALTER TABLE ${this.id(tableName)} MODIFY (${def});\n`;
  }
}

class MsSqlMaker extends SQLMaker{
  protected override onDeleteActions: readonly ReferentialAction[] = ["CASCADE", "SET NULL", "SET DEFAULT"];
  protected override onUpdateActions: readonly ReferentialAction[] = ["CASCADE", "SET NULL", "SET DEFAULT"];

  override makeTableComment(tableData: EntityData): string {
	  return this.extendedProperty("add", tableData.logicalName, tableData.physicalName);
  }
  makeColumnAI(): string {
	return " IDENTITY(1,1)";
  }
  override makeColumnComment(tableName: string, columnData: FieldData): string {
	  return this.extendedProperty("add", columnData.comment, tableName, columnData.column);
  }
  /** 설명(MS_Description) 추가/수정/삭제 */
  private extendedProperty(action: "add" | "update" | "drop", comment: string | undefined, tableName: string, column?: string): string {
	const value = action === "drop" ? "" : ` N'${sqlString(comment)}',`;
	const columnPart = column === undefined ? "" : `, N'column', N'${sqlString(column)}'`;
	return `EXEC sp_${action}extendedproperty N'MS_Description',${value} N'schema', N'dbo', N'table', N'${sqlString(tableName)}'${columnPart};\n`;
  }
  override changeColumnComment(tableName: string, oldField: FieldData, newField: FieldData): string {
	return this.extendedProperty(!newField.comment ? "drop" : oldField.comment ? "update" : "add", newField.comment, tableName, newField.column);
  }
  override changeTableComment(tableData: EntityData, oldComment?: string): string {
	return this.extendedProperty(!tableData.logicalName ? "drop" : oldComment ? "update" : "add", tableData.logicalName, tableData.physicalName);
  }
  protected override createView(replace: boolean): string {
	return replace ? "CREATE OR ALTER VIEW" : "CREATE VIEW";
  }
  protected override sequenceType(): string {
	return " AS BIGINT";
  }
  override renameTable(oldName: string, newName: string): string {
	return `EXEC sp_rename N'${sqlString(oldName)}', N'${sqlString(newName)}';\n`;
  }
  override renameColumn(tableName: string, oldName: string, newName: string): string {
	return `EXEC sp_rename N'${sqlString(tableName)}.${sqlString(oldName)}', N'${sqlString(newName)}', N'COLUMN';\n`;
  }
  modifyColumn(tableName: string, oldField: FieldData, newField: FieldData): string {
	let sql = "";
	if (oldField.dataType !== newField.dataType || !!oldField.notNull !== !!newField.notNull) {
		sql += `ALTER TABLE ${this.id(tableName)} ALTER COLUMN ${this.id(newField.column)} ${sqlDataType(newField.dataType)}${newField.notNull ? " NOT NULL" : " NULL"};\n`;
	}
	if (oldField.defaultValue !== newField.defaultValue) {
		sql += lineComment(`${tableName}.${newField.column}: drop the existing default constraint first`);
		if (newField.defaultValue !== undefined && newField.defaultValue !== "") {
			sql += `ALTER TABLE ${this.id(tableName)} ADD DEFAULT ${this.sqlDefault(newField.defaultValue)} FOR ${this.id(newField.column)};\n`;
		}
	}
	return sql;
  }
  override dropIndex(tableName: string, indexName: string): string {
	return `DROP INDEX ${this.id(indexName)} ON ${this.id(tableName)};\n`;
  }
}

class PostgreSqlMaker extends SQLMaker{
  override makeTableComment(tableData: EntityData): string {
	  return `COMMENT ON TABLE ${this.id(tableData.physicalName)} IS '${sqlString(tableData.logicalName)}';\n`;
  }
  makeColumnAI(): string {
	return " GENERATED BY DEFAULT AS IDENTITY";
  }
  override makeColumnComment(tableName: string, columnData: FieldData): string {
	  return `COMMENT ON COLUMN ${this.id(tableName)}.${this.id(columnData.column)} IS ${columnData.comment ? `'${sqlString(columnData.comment)}'` : "NULL"};\n`;
  }
  override changeTableComment(tableData: EntityData): string {
	return `COMMENT ON TABLE ${this.id(tableData.physicalName)} IS ${tableData.logicalName ? `'${sqlString(tableData.logicalName)}'` : "NULL"};\n`;
  }
  override addColumn(tableName: string, field: FieldData): string {
	return `ALTER TABLE ${this.id(tableName)} ADD COLUMN ${this.columnDefinition(field)};\n`;
  }
  modifyColumn(tableName: string, oldField: FieldData, newField: FieldData): string {
	const prefix = `ALTER TABLE ${this.id(tableName)} ALTER COLUMN ${this.id(newField.column)}`;
	let sql = "";
	if (oldField.dataType !== newField.dataType) sql += `${prefix} TYPE ${sqlDataType(newField.dataType)};\n`;
	if (!!oldField.notNull !== !!newField.notNull) sql += `${prefix} ${newField.notNull ? "SET" : "DROP"} NOT NULL;\n`;
	if (oldField.defaultValue !== newField.defaultValue) {
		sql += newField.defaultValue === undefined || newField.defaultValue === ""
			? `${prefix} DROP DEFAULT;\n`
			: `${prefix} SET DEFAULT ${this.sqlDefault(newField.defaultValue)};\n`;
	}
	return sql;
  }
}

class MariaDBMaker extends SQLMaker{
  protected override escapeBackslash = true;

  override quoteIdentifier(name: string): string {
	return `\`${name.replace(/`/g, "``")}\``;
  }
  override makeTableComment4Tail(comment?: string): string {
	  return comment ? ` COMMENT='${sqlString(comment, true)}' ` : "";
  }
  makeColumnAI(): string {
	return " AUTO_INCREMENT";
  }
  override makeColumnCommentInColumn(comment: string): string {
	  return `    COMMENT '${sqlString(comment, true)}'`;
  }
  override changeColumnComment(): string {
	return "";		// modifyColumn에서 컬럼 정의 전체(주석 포함)를 다시 지정
  }
  override changeTableComment(tableData: EntityData): string {
	return `ALTER TABLE ${this.id(tableData.physicalName)} COMMENT = '${sqlString(tableData.logicalName ?? "", true)}';\n`;
  }
  override renameTable(oldName: string, newName: string): string {
	return `RENAME TABLE ${this.id(oldName)} TO ${this.id(newName)};\n`;
  }
  override addColumn(tableName: string, field: FieldData): string {
	return `ALTER TABLE ${this.id(tableName)} ADD COLUMN ${this.columnDefinition(field)};\n`;
  }
  modifyColumn(tableName: string, _oldField: FieldData, newField: FieldData): string {
	return `ALTER TABLE ${this.id(tableName)} MODIFY COLUMN ${this.columnDefinition(newField, false)};\n`;
  }
  override dropPrimaryKey(tableName: string): string {
	return `ALTER TABLE ${this.id(tableName)} DROP PRIMARY KEY;\n`;
  }
  override dropForeignKey(tableName: string, name: string): string {
	return `ALTER TABLE ${this.id(tableName)} DROP FOREIGN KEY ${this.id(name)};\n`;
  }
  override dropIndex(tableName: string, indexName: string): string {
	return `DROP INDEX ${this.id(indexName)} ON ${this.id(tableName)};\n`;
  }
}
