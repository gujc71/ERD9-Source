/*
 DDL에서 테이블, 관계, 인덱스, 뷰, 시퀀스 정보 추출.
 MariaDB, PostgreSQL, MS-SQL은 SQL 파서(node-sql-parser)로 구문을 분석하고, 분석하지 못한 구문과 Oracle은 정규식으로 처리한다.
 정규식 처리는 콤마와 괄호로 구분하니 사용여부 잘 확인.
*/
import type { DbmsType, ReferentialAction } from "../constants";
import { REFERENTIAL_ACTIONS } from "../constants";
import type { CheckData, FieldData, IndexData, SequenceObject, ViewObject } from "../types";
import { diagramUtil } from "../util/diagramUtil";
import { LogBuffer } from "../util/logBuffer";
import { createYielder } from "../util/sleep";

/** DDL에서 추출한 테이블 정보 */
export interface ImportTableData {
	physicalName: string;
	logicalName?: string;
	columns: FieldData[];
	indexes?: IndexData[];
	checks?: CheckData[];
}

/** DDL에서 추출한 관계 정보 */
export interface ImportRelationData {
	name: string;
	childTable: string;
	childFields: string;
	parentTable: string;
	parentFields: string;
	onDelete?: ReferentialAction;
	onUpdate?: ReferentialAction;
}

/** node-sql-parser의 AST (형식이 DBMS마다 조금씩 달라 느슨하게 다룬다) */
type Ast = any;
interface SqlParser { astify(sql: string, options?: { database: string }): Ast }

/** DBMS별 파서. 필요할 때만 불러온다 (코드 분할) */
async function loadParser(dbms: DbmsType): Promise<{ parser: SqlParser; database: string } | null> {
	try {
		switch (dbms) {
			case "mariadb":    return { parser: new (await import("node-sql-parser/build/mariadb")).Parser(), database: "MariaDB" };
			case "postgresql": return { parser: new (await import("node-sql-parser/build/postgresql")).Parser(), database: "PostgresQL" };
			case "mssql":      return { parser: new (await import("node-sql-parser/build/transactsql")).Parser(), database: "TransactSQL" };
		}
	} catch (error) {
		console.error("Failed to load the SQL parser.", error);
	}
	return null;		// Oracle은 지원하지 않음
}

/** 따옴표(', ", `)로 시작하는 문자열의 닫는 따옴표 위치. 따옴표 두 개는 이스케이프 */
function quotedEnd(sql: string, start: number): number {
	const ch = sql[start];
	let end = start + 1;
	while (end < sql.length && !(sql[end] === ch && sql[end + 1] !== ch)) end += sql[end] === ch ? 2 : 1;
	return end;
}

/**
 * start 위치가 주석의 시작이면 주석의 마지막 위치(end)와 대신 넣을 문자열.
 * 줄 주석(--, slashLineComment이면 //)은 줄바꿈 앞까지, 블록 주석은 공백 하나로 바꾼다.
 */
function commentEnd(sql: string, start: number, slashLineComment: boolean): { end: number; replacement: string } | null {
	const ch = sql[start], next = sql[start + 1];
	if ((ch === "-" && next === "-") || (slashLineComment && ch === "/" && next === "/")) {
		const end = sql.indexOf("\n", start);
		return { end: end === -1 ? sql.length : end - 1, replacement: "" };
	}
	if (ch === "/" && next === "*") {
		const end = sql.indexOf("*/", start + 2);
		return { end: end === -1 ? sql.length : end + 1, replacement: " " };
	}
	return null;
}

/**
 * 따옴표 밖의 주석 제거 ('http://...'처럼 문자열 안의 주석 기호는 유지).
 * slashLineComment: // 도 줄 주석으로 처리
 */
export function stripSQLComments(sql: string, slashLineComment = false): string {
	let result = "";
	let from = 0;
	for (let i = 0; i < sql.length; i++) {
		const ch = sql[i];
		if (ch === "'" || ch === '"' || ch === "`") {
			i = quotedEnd(sql, i);
			continue;
		}
		const comment = commentEnd(sql, i, slashLineComment);
		if (comment) {
			result += sql.substring(from, i) + comment.replacement;
			i = comment.end;
			from = i + 1;
		}
	}
	return result + sql.substring(from);
}

/**
 * SQL을 구문 단위로 나눈다. 따옴표 안의 세미콜론은 무시하고, 주석과 MS-SQL의 GO 구분자를 처리한다.
 */
export function splitStatements(sql: string): string[] {
	const statements: string[] = [];
	let current = "";
	for (let i = 0; i < sql.length; i++) {
		const ch = sql[i];
		if (ch === "'" || ch === '"' || ch === "`") {
			const end = quotedEnd(sql, i);
			current += sql.substring(i, end + 1);
			i = end;
			continue;
		}
		const comment = commentEnd(sql, i, false);
		if (comment) {
			i = comment.end;
			current += comment.replacement;
			continue;
		}
		if (ch === ";") {
			statements.push(current);
			current = "";
			continue;
		}
		current += ch;
	}
	statements.push(current);
	// MS-SQL: 한 줄에 GO만 있으면 구문 구분자
	return statements.flatMap(s => s.split(/^\s*GO\s*$/im)).map(s => s.trim()).filter(Boolean);
}

/** 여는 괄호 위치부터 짝이 맞는 닫는 괄호까지의 내용 */
function balancedParens(text: string, open: number): string | null {
	let depth = 0;
	for (let i = open; i < text.length; i++) {
		const ch = text[i];
		if (ch === "'") {
			const end = text.indexOf("'", i + 1);
			if (end === -1) return null;
			i = end;
			continue;
		}
		if (ch === "(") depth++;
		if (ch === ")" && --depth === 0) return text.substring(open + 1, i);
	}
	return null;
}

/** 식별자의 따옴표 제거: `a`, "a", [a] */
function unquote(name: string): string {
	return name.trim().replace(/^[`"[]|[`"\]]$/g, "");
}

/** CREATE/ALTER TABLE 구문의 CHECK 제약조건 (원문에서 추출하므로 조건식의 대소문자가 유지된다) */
export function extractChecks(statement: string, tableName: string): CheckData[] {
	const checks: CheckData[] = [];
	const regex = /(?:CONSTRAINT\s+([`"[]?[\w$#]+[`"\]]?)\s+)?CHECK\s*\(/gi;
	let match: RegExpExecArray | null;
	while ((match = regex.exec(statement))) {
		const expression = balancedParens(statement, match.index + match[0].length - 1);
		if (expression === null) continue;
		checks.push({ name: match[1] ? unquote(match[1]) : `CK_${tableName}_${checks.length + 1}`, expression: expression.trim() });
	}
	return checks;
}

function toAction(value: unknown): ReferentialAction | undefined {
	const action = String(value ?? "").toUpperCase().replace(/\s+/g, " ").trim() as ReferentialAction;
	return REFERENTIAL_ACTIONS.includes(action) ? action : undefined;
}

export class Sql2Json {
	tableMap: Record<string, ImportTableData> = {};
	tableList: ImportTableData[] = [];
	relationList: ImportRelationData[] = [];
	views: ViewObject[] = [];
	sequences: SequenceObject[] = [];
	private log?: LogBuffer;

	/** 로그는 버퍼에 모았다가 프레임마다 한 번에 출력 (줄마다 DOM 추가/스크롤하면 로그가 길수록 느려짐) */
	logInfo(msg: string): void {
		this.log?.add("span", "log-span", msg);
	}
	logError(msg: string): void {
		this.log?.add("span", "log-span log-error", msg);
	}
	/** 버퍼에 남은 로그를 바로 출력 */
	flushLog(): void {
		this.log?.flush();
	}
	async extract(sql: string, logEditor?: HTMLElement, dbms: DbmsType = "oracle"): Promise<void> {
	  this.flushLog();
	  if (logEditor) logEditor.innerHTML = "";
	  this.log = logEditor ? new LogBuffer(logEditor) : undefined;
	  this.initResult();

	  const ast = await loadParser(dbms);
	  // 시간 분할: 일정 시간마다만 화면 갱신을 위해 양보 (구문마다 고정 지연을 두면 구문이 많을 때 매우 느림)
	  const yieldToUI = createYielder(16, () => this.flushLog());
	  let parsedCount = 0;
	  for (const statement of splitStatements(sql)) {
		if (logEditor) await yieldToUI();
		const head = statement.replace(/\s+/g, " ").toUpperCase();

		if (/^CREATE (OR REPLACE )?(FORCE )?VIEW /.test(head) || /^CREATE OR ALTER VIEW /.test(head)) {
			this.extractView(statement);
			continue;
		}
		if (head.startsWith("CREATE SEQUENCE ")) {
			this.extractSequence(statement);
			continue;
		}
		if (ast && /^(CREATE TABLE|ALTER TABLE|CREATE (UNIQUE )?(NONCLUSTERED |CLUSTERED )?INDEX)/.test(head)) {
			try {
				const result = ast.parser.astify(statement, { database: ast.database });
				if (this.extractAst(Array.isArray(result) ? result[0] : result, statement)) {
					parsedCount++;
					continue;
				}
			} catch {
				// 분석하지 못한 구문은 정규식으로 처리
			}
		}
		this.extractStatement(statement);
	  }
	  if (ast) this.logInfo(`Statements analyzed by the SQL parser: ${parsedCount}`);
	  this.flushLog();
	}
	initResult(): void {
	  this.tableMap = {};
	  this.tableList = [];
      this.relationList = [];
	  this.views = [];
	  this.sequences = [];
	}

	private getTable(name: string): ImportTableData | undefined {
		return this.tableMap[name.toUpperCase()];
	}
	private addTable(tableData: ImportTableData): void {
		this.tableList.push(tableData);
		this.tableMap[tableData.physicalName.toUpperCase()] = tableData;
		this.logInfo(`imported : ${tableData.physicalName} (${tableData.columns.length} columns)`);
	}

	/* -----------------------------------------------------------------------------------
	 * SQL 파서(AST)로 분석한 구문. 처리하지 못하는 형식이면 false
	 */
	private extractAst(ast: Ast, statement: string): boolean {
		if (!ast) return false;
		if (ast.type === "create" && ast.keyword === "table" && Array.isArray(ast.create_definitions)) {
			this.astTable(ast, statement);
			return true;
		}
		if (ast.type === "create" && ast.keyword === "index") {
			const tableData = this.getTable(ast.table?.table ?? "");
			if (!tableData || !ast.index) return false;
			const fields = (ast.index_columns ?? []).map((c: Ast) => this.astName(c));
			this.addIndex(tableData, { name: ast.index, fields: fields.join(","), ...(String(ast.index_type).toLowerCase() === "unique" ? { unique: true } : {}) });
			return true;
		}
		if (ast.type === "alter" && Array.isArray(ast.expr)) {
			const tableName = ast.table?.[0]?.table;
			const tableData = this.getTable(tableName ?? "");
			if (!tableName) return false;
			for (const expr of ast.expr) {
				if (expr.action !== "add" || expr.resource !== "constraint") return false;
			}
			for (const expr of ast.expr) {
				this.astConstraint(tableData, tableName, expr.create_definitions, statement);
			}
			return true;
		}
		return false;
	}

	/** 컬럼명. 문자열 또는 { expr: { value } } */
	private astName(column: Ast): string {
		const value = column?.column ?? column;
		if (typeof value === "string") return value;
		return String(value?.expr?.value ?? value?.value ?? "");
	}

	private astDataType(definition: Ast): string {
		let dataType = String(definition?.dataType ?? "UNKNOWN");
		if (definition?.length !== undefined && definition?.length !== null) {
			dataType += `(${String(definition.length).toUpperCase()}${definition.scale !== undefined && definition.scale !== null ? "," + definition.scale : ""})`;
		}
		return dataType;
	}

	private astDefault(value: Ast): string | number | undefined {
		if (!value) return undefined;
		switch (value.type) {
			case "number": return value.value;
			case "single_quote_string":
			case "string": return `'${String(value.value).replace(/'/g, "''")}'`;
			case "bool": return String(value.value).toUpperCase();
			case "null": return undefined;
			case "function": {
				const name = value.name?.name?.[0]?.value ?? value.name;
				return typeof name === "string" ? name.toUpperCase() + (value.args?.value?.length === 0 ? "()" : "") : undefined;
			}
			default: return typeof value.value === "string" || typeof value.value === "number" ? value.value : undefined;
		}
	}

	private astTable(ast: Ast, statement: string): void {
		const tableName = ast.table[0].table as string;
		const tableData: ImportTableData = { physicalName: tableName, columns: [] };
		const constraints: Ast[] = [];

		for (const def of ast.create_definitions) {
			if (def.resource !== "column") {
				constraints.push(def);
				continue;
			}
			const column: FieldData = {
				id: "f" + diagramUtil.getUniqueID(),
				column: this.astName(def.column),
				dataType: this.astDataType(def.definition),
				notNull: String(def.nullable?.type ?? "").replace(/\s/g, "").toLowerCase() === "notnull",
				isPK: !!def.primary_key,
			};
			const defaultValue = this.astDefault(def.default_val?.value);
			if (defaultValue !== undefined) column.defaultValue = defaultValue;
			if (def.auto_increment) column.ai = true;
			if (def.unique) column.uniqueKey = true;
			const comment = def.comment?.value?.value;
			if (typeof comment === "string") column.comment = comment;
			if (column.isPK) column.notNull = true;
			tableData.columns.push(column);

			// 컬럼에 바로 지정한 외래키: col INT REFERENCES parent(id)
			if (def.reference_definition) {
				this.astForeignKey(tableName, null, [def.column], def.reference_definition);
			}
		}

		const tableComment = (ast.table_options ?? []).find((o: Ast) => String(o.keyword).toLowerCase() === "comment");
		tableData.logicalName = tableComment ? String(tableComment.value).replace(/^'|'$/g, "") : tableName;

		this.addTable(tableData);
		for (const def of constraints) {
			this.astConstraint(tableData, tableName, def, statement);
		}
		const checks = extractChecks(statement, tableName);
		if (checks.length) tableData.checks = checks;
	}

	/** 테이블 제약조건, 인덱스 (CREATE TABLE 안 또는 ALTER TABLE ADD) */
	private astConstraint(tableData: ImportTableData | undefined, tableName: string, def: Ast, statement: string): void {
		if (!def) return;
		const type = String(def.constraint_type ?? "").replace(/\s/g, "").toLowerCase();
		const columns: string[] = (def.definition ?? []).map((c: Ast) => this.astName(c)).filter(Boolean);

		if (type === "foreignkey") {
			this.astForeignKey(tableName, def.constraint, def.definition, def.reference_definition);
			return;
		}
		if (!tableData) {
			this.logError(`The table is not found: ${tableName}`);
			return;
		}
		if (type === "primarykey") {
			this._setPK(tableData, columns);
		} else
		if (type.startsWith("unique")) {
			this.addIndex(tableData, { name: def.constraint || def.index || `UQ_${tableName}_${columns.join("_")}`, fields: columns.join(","), unique: true });
		} else
		if (type === "check") {
			// CREATE TABLE의 CHECK는 원문에서 한 번에 추출. ALTER TABLE ADD CHECK만 여기서 처리
			if (/^\s*ALTER/i.test(statement)) {
				tableData.checks = [...(tableData.checks ?? []), ...extractChecks(statement, tableName)];
			}
		} else
		if (def.resource === "index" || type === "fulltextindex" || def.keyword === "fulltext") {
			if (def.index) this.addIndex(tableData, { name: def.index, fields: columns.join(",") });
		}
	}

	private astForeignKey(tableName: string, name: string | null, childColumns: Ast[], reference: Ast): void {
		const parentTable = reference?.table?.[0]?.table;
		if (!parentTable) return;
		const relation: ImportRelationData = {
			name: name || "FK_" + diagramUtil.getUniqueID().substring(0, 12),
			childTable: tableName,
			childFields: childColumns.map(c => this.astName(c)).join(","),
			parentTable,
			parentFields: (reference.definition ?? []).map((c: Ast) => this.astName(c)).join(","),
		};
		for (const action of reference.on_action ?? []) {
			const event = String(action.type).replace(/\s/g, "").toLowerCase();
			if (event === "ondelete") relation.onDelete = toAction(action.value?.value);
			if (event === "onupdate") relation.onUpdate = toAction(action.value?.value);
		}
		this.relationList.push(relation);
		this.logInfo(`imported relationship: ${tableName} - ${parentTable} `);
	}

	private addIndex(tableData: ImportTableData, index: IndexData): void {
		if (!tableData.indexes) tableData.indexes = [];
		tableData.indexes.push(index);
		this.logInfo(`imported Index: ${index.name} - ${tableData.physicalName} (${index.fields})${index.unique ? " UNIQUE" : ""}`);
	}

	/* -----------------------------------------------------------------------------------
	 * 뷰, 시퀀스 (원문에서 추출)
	 */
	extractView(statement: string): void {
		const match = statement.match(/^\s*CREATE\s+(?:OR\s+(?:REPLACE|ALTER)\s+)?(?:FORCE\s+)?VIEW\s+([^\s(]+)(?:\s*\([^)]*\))?\s+AS\s+([\s\S]+)$/i);
		if (!match) {
			this.logError("Invalid view information. - " + statement.substring(0, 100));
			return;
		}
		const name = unquote(match[1].split(".").pop()!);
		this.views.push({ id: "v" + diagramUtil.getUniqueID(), name, query: match[2].trim() });
		this.logInfo(`imported View: ${name}`);
	}

	extractSequence(statement: string): void {
		const match = statement.match(/^\s*CREATE\s+SEQUENCE\s+(?:IF\s+NOT\s+EXISTS\s+)?([^\s;]+)/i);
		if (!match) {
			this.logError("Invalid sequence information. - " + statement.substring(0, 100));
			return;
		}
		const option = (pattern: RegExp) => {
			const m = statement.match(pattern);
			return m ? Number(m[1]) : undefined;
		};
		const name = unquote(match[1].split(".").pop()!);
		this.sequences.push({
			id: "s" + diagramUtil.getUniqueID(),
			name,
			start: option(/START\s+(?:WITH\s+)?(-?\d+)/i),
			increment: option(/INCREMENT\s+(?:BY\s+)?(-?\d+)/i),
			minValue: option(/MINVALUE\s+(-?\d+)/i),
			maxValue: option(/MAXVALUE\s+(-?\d+)/i),
			cycle: /\bCYCLE\b/i.test(statement.replace(/\bNO\s*CYCLE\b/gi, "")) || undefined,
		});
		this.logInfo(`imported Sequence: ${name}`);
	}

	/* -----------------------------------------------------------------------------------
	 * 정규식 처리 (Oracle, SQL 파서가 분석하지 못한 구문)
	 */
	private extractStatement(statement: string): void {
		let sqlLine = statement.toUpperCase();
		// 테이블 전처리
		sqlLine = sqlLine.replace(/\s{2,}/g, " "); // 여러개의 공백을 하나로
		sqlLine = sqlLine.replace(/`|"|\[|\]/g, ""); 		// 불필요 문자 제거
		sqlLine = sqlLine.replace(/DBO\./g, '');  	//ms-sql dbo. 제거

		if (sqlLine.startsWith("CREATE TABLE")) {
			this.extractTable(sqlLine, statement);
		} else
		if (/^CREATE (UNIQUE )?(NONCLUSTERED |CLUSTERED )?INDEX/.test(sqlLine)) {
			this.extractIndex (sqlLine);
		} else
		if (sqlLine.startsWith("ALTER TABLE")) {
			this.extractRelation (sqlLine, statement);
		} else
		if (sqlLine.startsWith("EXEC SP_ADDEXTENDEDPROPERTY")) {
			this.extractComment4MSSQL (sqlLine, statement);
		} else
		if (sqlLine.startsWith("COMMENT ON")) {
			this.extractComment4Oracle (sqlLine, statement);
		}
	}

	extractTable(statementTable: string, original = statementTable): void {
      const tableMatch = statementTable.match(/CREATE TABLE\s+(IF NOT EXISTS\s)*([^\s(]+)/i);
      if (!tableMatch) {
		return;
      }
      const tableData: ImportTableData = {
        physicalName: tableMatch[tableMatch.length-1].split(".").pop()!,
        columns: [],
      };

	  // 컬럼 정보 추출
	  const startIndex = statementTable.indexOf("(");
	  const endIndex   = this._getLastBracketPosition(statementTable);
	  if (startIndex === -1 || endIndex===-1) {
		if (statementTable.length>100) statementTable = statementTable.substring(100);
		this.logError("Invalid table information. : " + statementTable.replace(/\n/g, ""));
		return;
	  }
	  const tableInfoStr = statementTable.substring(endIndex+1); // mariadb용 코멘트
	  const match = tableInfoStr.match(/COMMENT\s*=\s*'([^']+)'/);
	  tableData.logicalName = match ? match[1] : tableData.physicalName;

	  // 작업할 테이블 본문 내용
	  statementTable = statementTable.substring(startIndex + 1, endIndex);

	  // 테이블 전처리 - 괄호 안의 콤마를 "@@@"로 변환. 콤마로 컬럼 구분하기 위해. 처리후 원복. number(10,2)
	  statementTable = statementTable.replace(/\(([^)]+)\)/g, (match) => {
		 return match.replace(/,/g, "@@@");
	  });

      const statementColumns = statementTable.split(",");
      statementColumns.forEach((statementColumn) => {
		  if (!statementColumn) return;
	      // 원본
		  statementColumn = statementColumn.replaceAll("@@@", ",");

		  // 컬럼 전처리: 괄호안에 숫자,콤마,공백이 있으면 데이터 타입의 자릿수이므로 공백 제거.  varchar ( 10 ) => varchar(10)
		  statementColumn = statementColumn.replace(/[\s]*\(([\d,\s]*)\)/g, (match) => {
		 	return match.replace(/\s/g, "");
		  });

		  // 공백으로 분할
          const colParts = statementColumn.trim().split(/\s+/);
		  if (colParts.length <2) {
			this.logError("Invalid comumn information. : " + statementColumn);
			return;
		  }
		  if (colParts[0]==="CONSTRAINT") {
			const match = statementColumn.match(/PRIMARY KEY[^)]*\(([^)]+)\)/);
			if (match) this._setPK(tableData, match[1].split(","));
			const unique = statementColumn.match(/^\s*CONSTRAINT\s+(\S+)\s+UNIQUE[^(]*\(([^)]+)\)/);
			if (unique) this._setUnique(tableData, unique[2], unique[1]);

			this._setRelation(tableData.physicalName, statementColumn);
			return;
		  }
		  if (colParts[0]==="PRIMARY") { // MariaDB
			// 괄호 내용 추출
			const match = statementColumn.match(/\(((?:[^()]+|\([^()]*\))*)\)/) ;
			if (match) this._setPK(tableData, match[1].split(","));
		    return;
		  }
		  if (colParts[0]==="UNIQUE") { // UNIQUE (a, b), UNIQUE KEY name (a, b)
			const unique = statementColumn.match(/^\s*UNIQUE(?:\s+(?:KEY|INDEX))?\s*([^\s(]*)\s*\(([^)]+)\)/);
			if (unique) this._setUnique(tableData, unique[2], unique[1]);
		    return;
		  }
		  if (colParts[0]==="CHECK") {	// CHECK는 원문에서 한 번에 추출
		    return;
		  }
		  if (colParts[0]==="INDEX" || colParts[0]==="KEY") {  // MariaDB
			this._setIndex(tableData, colParts[1], statementColumn);
		    return;
		  }
		  if (colParts[0]==="FULLTEXT" ) {  // MariaDB - FULLTEXT KEY
			this._setIndex(tableData, colParts[2], statementColumn);
		    return;
		  }
		  if (colParts[0]==="FOREIGN") {  // MariaDB, ms-sql
			this._setRelation(tableData.physicalName, "CONSTRAINT FK_" + diagramUtil.getUniqueID().substring(0, 12) + " " + statementColumn);
		    return;
		  }

          const colData: FieldData = {
            id: "f" + diagramUtil.getUniqueID(),
            isPK: statementColumn.includes("PRIMARY KEY"),
            notNull: statementColumn.includes("NOT NULL"),
            column: colParts[0],
            dataType: colParts[1],
          };
		  if (colParts[2] && colParts[2].startsWith("(")) colData.dataType += colParts[2]; // ex: varchar   (10)

		  const match1 = statementColumn.match(/DEFAULT (\S+)/);
		  if (match1) {
			if (match1[1] !== "AS")
				colData.defaultValue = match1[1];
			else
			if (statementColumn.includes("IDENTITY") ) colData.ai = true; // oracle: region_id NUMBER GENERATED BY DEFAULT AS IDENTITY
		  }
          tableData.columns.push(colData);

		  if (colParts.indexOf("COMMENT")>-1) {  // MariaDB Comment
			const match = statementColumn.match(/COMMENT\s+'([^']+)'/);
			if (match) colData.comment = match[1];
		  }
		  if (colParts.indexOf("AUTO_INCREMENT")>-1) {  // MariaDB default
			colData.ai = true;
		  }
		  if (colParts.indexOf("UNIQUE")>-1) {
			colData.uniqueKey = true;
		  }

		  const match4mssql = statementColumn.match(/IDENTITY[\s]*\(([^)]+)\)/);  // mssql
		  if (match4mssql)  colData.ai = true;

		  // 컬럼에 바로 지정한 외래키: col INT REFERENCES parent(id)
		  const reference = statementColumn.match(/REFERENCES\s+([^\s(]+)\s*\(([^)]+)\)(.*)$/);
		  if (reference) {
			this._addRelation({ name: "FK_" + diagramUtil.getUniqueID().substring(0, 12), childTable: tableData.physicalName, childFields: colData.column,
								parentTable: reference[1], parentFields: reference[2].replace(/\s/g, "") }, reference[3]);
		  }
      });
	  const checks = extractChecks(original, tableData.physicalName);
	  if (checks.length) tableData.checks = checks;
	  this.addTable(tableData);
    }

	/** original: 대소문자를 바꾸지 않은 원문 (주석 내용 유지) */
	extractComment4MSSQL(sqlLine: string, original = sqlLine): void {
		// 홑따옴표 사이의 문자열 추출
		const commentData = original.match(/'(.*?)'/g);
		if (!commentData) return;

		let chk = false;
		if (commentData.length===6) { // table comment
			const tableName = commentData[5].replace(/'/g, "");
			const tableData = this.getTable(tableName);
			if (tableData) {
				tableData.logicalName = commentData[1].replace(/'/g, "");
				this.logInfo(`imported comment: ${tableName} ${tableData.logicalName}`);
				chk = true;
			}
		} else
		if (commentData.length===8) { // column comment
			const tableName  = commentData[5].replace(/'/g, "");
			const column = commentData[7].replace(/'/g, "");
			const comment    = commentData[1].replace(/'/g, "");
			if (this._setColumnComment(this.getTable(tableName), column, comment) ){
				this.logInfo(`imported comment: ${tableName}.${column} ${comment}`);
				chk = true;
			}
		}
		if (!chk) this.logError("Invalid comment information. - " + sqlLine);
	}

	extractComment4Oracle(sqlLine: string, original = sqlLine): void {
	    // 공백으로 분할
        const commentData = sqlLine.trim().split(/\s+/);
		const comment = (original.match(/\sIS\s+'([\s\S]*)'\s*$/i)?.[1] ?? commentData[5] ?? "").replace(/''/g, "'");

		let chk = false;
		if (commentData[2]==="TABLE") { // table comment
			const tableData = this.getTable(commentData[3].split(".").pop()!);
			if (tableData) {
				tableData.logicalName = comment;
				this.logInfo(`imported comment: ${tableData.physicalName} ${tableData.logicalName}`);
				chk = true;
			}
		} else
		if (commentData[2]==="COLUMN") { // column comment
			const columnData = commentData[3].split(".").slice(-2);
			if (this._setColumnComment(this.getTable(columnData[0]), columnData[1], comment)) {
				this.logInfo(`imported comment: ${columnData[0]}.${columnData[1]} ${comment}`);
				chk = true;
			}
		}
		if (!chk) this.logError("Invalid comment information. - " + sqlLine);
	}

	private _getLastBracketPosition (str: string): number {
	  for (let i = str.length-1; i >0 ; i--) {
		if (str[i] === ")") return i;
	  }
	  return -1;
	}
	private _setPK(tableData: ImportTableData, pkList: string[]): void {
		pkList.forEach((pk) => {
		  const flds = pk.trim().split(" ");
		  const column = tableData.columns.find(col => col.column.toUpperCase() === unquote(flds[0]).toUpperCase());
		  if (column) {
			column.isPK = true;
			column.notNull = true;
		  }
		});
	}
	private _setUnique(tableData: ImportTableData, fieldList: string, name?: string): void {
		const fields = fieldList.split(",").map(f => unquote(f.trim().split(/\s+/)[0]));
		this.addIndex(tableData, { name: name || `UQ_${tableData.physicalName}_${fields.join("_")}`, fields: fields.join(","), unique: true });
	}
	extractIndex(sqlLine: string): void {
		const unique = /^CREATE UNIQUE/.test(sqlLine);
		// 전처리: UNIQUE, CLUSTERED 제거, 테이블명과 ( 사이에 공백이 없으면 삽입.
		sqlLine = sqlLine.replace(/^CREATE (UNIQUE )?(NONCLUSTERED |CLUSTERED )?INDEX/, "CREATE INDEX").replace(/(\([^ ])/g, " $1");
		// 공백으로 분할
		const commentData = sqlLine.trim().split(/\s+/);
		if (commentData.length < 6) {
			this.logError("Invalid index information. - " + sqlLine);
			return;
		}
		const tableData = this.getTable(commentData[4].split(".").pop()!);
		if (!tableData) {
		    this.logError("Invalid index information. - " + sqlLine);
			return;
		}

		this._setIndex(tableData, commentData[2], sqlLine, unique);
	}
	private _setIndex(tableData: ImportTableData, indexName: string, sqlLine: string, unique = false): void {
		// 괄호 내용 추출
		const match = sqlLine.match(/\(((?:[^()]+|\([^()]*\))*)\)/) ;
	  	if (match) {
			const flds = match[1].split(",").map(item => item.trim().replace(" ASC", "").replace(" DESC", ""));
			this.addIndex(tableData, { name: indexName, fields: flds.toString(), ...(unique ? { unique: true } : {}) });
		} else
		    this.logError("Invalid table information. - " + sqlLine);
	}
	extractRelation(sqlLine: string, original = sqlLine): void {
	  const tableMatch = sqlLine.match(/ALTER TABLE\s+(?:ONLY\s+)?([^\s(]+)/i);
      if (!tableMatch) {
		return;
      }
	  const tableName = tableMatch[1].split(".").pop()!;
	  this._setRelation(tableName, sqlLine);

	  const tableData = this.getTable(tableName);
	  if (!tableData) return;
	  const unique = sqlLine.match(/ADD\s+CONSTRAINT\s+(\S+)\s+UNIQUE[^(]*\(([^)]+)\)/);
	  if (unique) this._setUnique(tableData, unique[2], unique[1]);
	  const pk = sqlLine.match(/ADD\s+(?:CONSTRAINT\s+\S+\s+)?PRIMARY KEY[^(]*\(([^)]+)\)/);
	  if (pk) this._setPK(tableData, pk[1].split(","));
	  const checks = extractChecks(original, tableName);
	  if (checks.length) tableData.checks = [...(tableData.checks ?? []), ...checks];
	}

	private _setRelation(tablename: string, sqlLine: string): void {
		const match = sqlLine.match(/CONSTRAINT[^)]*FOREIGN KEY\s*\([^)]*\)\s*REFERENCES\s*([^\s(]+)\s*\(\s*([^)]*)\s*\)((?:\s*ON\s+(?:DELETE|UPDATE)\s+(?:NO ACTION|CASCADE|SET NULL|SET DEFAULT|RESTRICT))*)/g);
		if (!match) return;

		match.forEach((fkStr) => {
			const actions = fkStr.match(/(\s*ON\s+(?:DELETE|UPDATE)\s+(?:NO ACTION|CASCADE|SET NULL|SET DEFAULT|RESTRICT))*$/)?.[0] ?? "";
			fkStr = fkStr.substring(0, fkStr.length - actions.length);
			// 전처리 1 - 괄호 앞이나 뒤에 공백이 없으면 공백 추가. 공백으로 자르기 위해 형식 맞춤
			const input = fkStr.replace(/(\S)(\(|\))/g, "$1 $2 ");
			// 전처리 2 - 괄호 안의 공백 제거
			const result = input.replace(/\(([^)]*)\)/g, (_match, group: string) => {
			  return group.replace(/\s/g, "");
			});

			const commentData = result.trim().split(/\s+/);
			if (commentData.length >6) {
				this._addRelation({name:commentData[1], childTable: tablename, childFields: commentData[4], parentTable: commentData[6].split(".").pop()!, parentFields: commentData[7]}, actions);
			}
			else this.logError("Invalid relationship information. - " + sqlLine);
		});
	}
	private _addRelation(relation: ImportRelationData, actions: string): void {
		relation.onDelete = toAction(actions.match(/ON\s+DELETE\s+(NO ACTION|CASCADE|SET NULL|SET DEFAULT|RESTRICT)/i)?.[1]);
		relation.onUpdate = toAction(actions.match(/ON\s+UPDATE\s+(NO ACTION|CASCADE|SET NULL|SET DEFAULT|RESTRICT)/i)?.[1]);
		this.relationList.push(relation);
		this.logInfo(`imported relationship: ${relation.childTable} - ${relation.parentTable} `);
	}
	private _setColumnComment(tableData: ImportTableData | undefined, column: string, comment: string): boolean {
		if (!tableData) return false;

		const columnData = tableData.columns.find(col => col.column.toUpperCase()===column.toUpperCase());
		if (!columnData) return false;
		columnData.comment = comment;
		return true;
	}
}

const SQL_KEYWORDS = new Set(["CREATE", "ALTER", "TABLE", "INDEX", "CONSTRAINT", "PRIMARY", "FOREIGN", "KEY", "EXEC", "ON", "COMMENT", "NOT", "NULL", "DEFAULT", "COLUMN",
							  "UNIQUE", "CHECK", "REFERENCES", "VIEW", "SEQUENCE", "DELETE", "UPDATE", "CASCADE"]);

/** 한 줄을 강조 표시한 HTML. 붙여넣은 SQL은 신뢰할 수 없으므로 HTML 이스케이프 */
function highlightLine(sqlLine: string): string {
	let formattedSQL = "";
	const sqlWords = sqlLine.replaceAll(",", ", ").split(/\s/);
	for (let sqlWord of sqlWords) {
		if (!sqlWord) {
			formattedSQL += " ";
			continue;
		}
		// 단어 마지막 붙은 ,에 공백 넣어 단어만 추출되도록
		let suffix = " ";
		const match = sqlWord.match(/[,;]$/);
		if (match) {
			sqlWord = sqlWord.replace(match[0], "");
			suffix = match[0] + " ";
		}
		const word = diagramUtil.escapeHTML(sqlWord);
		if (SQL_KEYWORDS.has(sqlWord.toUpperCase())) {
			formattedSQL += `<span class="sql-keyword">${word}</span>` + suffix;
		} else if ((sqlWord.startsWith("'") || sqlWord.startsWith("N'")) && sqlWord.endsWith("'")) {
			formattedSQL += `<span class="sql-string">${word}</span>` + suffix;
		} else {
			formattedSQL += word + suffix;
		}
	}
	return `<p class="sql-formatted">${formattedSQL}</p>`;
}

/**
 * SQL을 강조 표시해서 출력 (화면 표시 전용. 분석에는 원문을 사용할 것).
 * 주석은 제거해서 표시한다. 긴 SQL은 일정 시간마다 나누어 출력한다.
 */
const highlightRuns = new WeakMap<HTMLElement, number>();	// 출력 중에 다시 호출되면 이전 출력은 중단
export async function highlightSQL (sqlCode: string, sqlEditor: HTMLElement): Promise<void> {
	const run = (highlightRuns.get(sqlEditor) ?? 0) + 1;
	highlightRuns.set(sqlEditor, run);
	sqlEditor.innerText = "";
	const sqlLines = stripSQLComments(sqlCode, true).split(/\n/);

	let chunk: string[] = [];
	const flush = () => {
		if (chunk.length === 0) return;
		sqlEditor.insertAdjacentHTML("beforeend", chunk.join(""));
		chunk = [];
	};
	const yieldToUI = createYielder(16, flush);
	for (const sqlLine of sqlLines) {
		chunk.push(highlightLine(sqlLine));
		await yieldToUI();
		if (highlightRuns.get(sqlEditor) !== run) return;
	}
	flush();
}
