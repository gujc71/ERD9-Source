/**
 * 테이블 정의서 내보내기: Markdown, HTML, Excel(xlsx).
 * xlsx는 별도 라이브러리 없이 SpreadsheetML을 직접 만들고 fflate로 압축한다.
 */
import { strToU8, zipSync } from "fflate";
import { tableTitle } from "./tableDocModel";
import type { RelationDoc, TableDocColumn, TableDocument } from "./tableDocModel";

export type { RelationDoc, TableDoc, TableDocColumn, TableDocument } from "./tableDocModel";

const COLUMN_HEADER = ["No.", "Column Name", "Attribute Name", "Data Type", "Default", "PK", "UQ", "NN", "AI", "FK"];
const RELATION_HEADER = ["FK Name", "Table", "Columns", "References", "Columns", "On Delete", "On Update"];
const yn = (value: boolean) => value ? "Y" : "";

function columnRow(column: TableDocColumn, inx: number): string[] {
	return [String(inx + 1), column.column, column.comment, column.dataType, column.defaultValue,
			yn(column.pk), yn(column.unique), yn(column.notNull), yn(column.ai), column.fk];
}
function relationRow(relation: RelationDoc): string[] {
	return [relation.name, relation.childTable, relation.childFields, relation.parentTable, relation.parentFields, relation.onDelete, relation.onUpdate];
}

/* -----------------------------------------------------------------------------------
 * Markdown
 */
function mdCell(value: string): string {
	return value.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/[\r\n]+/g, " ");
}
function mdTable(header: string[], rows: string[][]): string {
	const line = (cells: string[]) => `| ${cells.map(mdCell).join(" | ")} |`;
	return [line(header), `|${header.map(() => " --- ").join("|")}|`, ...rows.map(line)].join("\n") + "\n";
}

export function toMarkdown(doc: TableDocument): string {
	let md = `# ${mdCell(doc.title)}\n\nDBMS: ${doc.dbms} · Tables: ${doc.tables.length}\n\n`;
	for (const table of doc.tables) {
		md += `## ${mdCell(tableTitle(table))}\n\n`;
		md += mdTable(COLUMN_HEADER, table.columns.map(columnRow));
		if (table.indexes.length) md += "\n" + mdTable(["Index", "Columns", "Unique"], table.indexes.map(i => [i.name, i.fields, yn(!!i.unique)]));
		if (table.checks.length) md += "\n" + mdTable(["Check", "Expression"], table.checks.map(c => [c.name, c.expression]));
		md += "\n";
	}
	if (doc.relations.length) md += "## Relationships\n\n" + mdTable(RELATION_HEADER, doc.relations.map(relationRow));
	return md;
}

/* -----------------------------------------------------------------------------------
 * HTML (스타일을 포함한 단독 문서)
 */
function escapeHTML(value: string): string {
	return value.replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
}
function htmlTable(header: string[], rows: string[][]): string {
	const head = `<tr>${header.map(h => `<th>${escapeHTML(h)}</th>`).join("")}</tr>`;
	const body = rows.map(row => `<tr>${row.map(cell => `<td>${escapeHTML(cell)}</td>`).join("")}</tr>`).join("\n");
	return `<table>\n<thead>${head}</thead>\n<tbody>\n${body}\n</tbody>\n</table>\n`;
}

export function toHTML(doc: TableDocument): string {
	let body = `<h1>${escapeHTML(doc.title)}</h1>\n<p class="meta">DBMS: ${escapeHTML(doc.dbms)} · Tables: ${doc.tables.length}</p>\n`;
	for (const table of doc.tables) {
		body += `<h2>${escapeHTML(tableTitle(table))}</h2>\n` + htmlTable(COLUMN_HEADER, table.columns.map(columnRow));
		if (table.indexes.length) body += htmlTable(["Index", "Columns", "Unique"], table.indexes.map(i => [i.name, i.fields, yn(!!i.unique)]));
		if (table.checks.length) body += htmlTable(["Check", "Expression"], table.checks.map(c => [c.name, c.expression]));
	}
	if (doc.relations.length) body += "<h2>Relationships</h2>\n" + htmlTable(RELATION_HEADER, doc.relations.map(relationRow));

	return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>${escapeHTML(doc.title)}</title>
<style>
body { font-family: "Segoe UI", "Malgun Gothic", sans-serif; font-size: 13px; margin: 24px; color: #202124; }
h1 { font-size: 20px; } h2 { font-size: 15px; margin-top: 28px; }
.meta { color: #5f6368; }
table { border-collapse: collapse; margin: 8px 0; }
th, td { border: 1px solid #9aa0a6; padding: 3px 8px; text-align: left; }
th { background: #e8f0fe; }
</style>
</head>
<body>
${body}</body>
</html>
`;
}

/* -----------------------------------------------------------------------------------
 * Excel (xlsx)
 */
/** XML 문자열. XML에서 허용하지 않는 제어 문자는 제거 */
function xml(value: string): string {
	return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
		.replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);
}

/** 0 -> A, 25 -> Z, 26 -> AA */
export function columnName(index: number): string {
	let name = "";
	for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
		name = String.fromCharCode(65 + (n - 1) % 26) + name;
	}
	return name;
}

/** 셀 스타일 (styles.xml의 cellXfs 순서) */
const STYLE = { normal: 0, header: 1, cell: 2, title: 3 } as const;
type Style = typeof STYLE[keyof typeof STYLE];

interface Sheet {
	name: string;
	widths: number[];
	rows: { cells: string[]; style: Style }[];
}

function sheetXML(sheet: Sheet): string {
	const cols = sheet.widths.map((width, i) => `<col min="${i + 1}" max="${i + 1}" width="${width}" customWidth="1"/>`).join("");
	const rows = sheet.rows.map((row, r) => {
		const cells = row.cells.map((value, c) =>
			`<c r="${columnName(c)}${r + 1}" t="inlineStr" s="${row.style}"><is><t xml:space="preserve">${xml(value)}</t></is></c>`).join("");
		return `<row r="${r + 1}">${cells}</row>`;
	}).join("");
	return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols>${cols}</cols><sheetData>${rows}</sheetData></worksheet>`;
}

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="13"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8F0FE"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color auto="1"/></left><right style="thin"><color auto="1"/></right><top style="thin"><color auto="1"/></top><bottom style="thin"><color auto="1"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

/** 시트 이름: 31자 이내, 사용할 수 없는 문자 제거, 중복되지 않게 */
function sheetName(name: string, used: Set<string>): string {
	const base = (name.replace(/[:\\/?*[\]]/g, "_").trim() || "Sheet").substring(0, 31);
	let result = base;
	for (let i = 2; used.has(result.toUpperCase()); i++) {
		const suffix = `_${i}`;
		result = base.substring(0, 31 - suffix.length) + suffix;
	}
	used.add(result.toUpperCase());
	return result;
}

export function makeSheets(doc: TableDocument): Sheet[] {
	const used = new Set<string>();
	const summary: Sheet = {
		name: sheetName("Tables", used),
		widths: [6, 30, 40, 10],
		rows: [
			{ cells: [doc.title], style: STYLE.title },
			{ cells: [`DBMS: ${doc.dbms}`], style: STYLE.normal },
			{ cells: [], style: STYLE.normal },
			{ cells: ["No.", "Table Name", "Entity Name", "Columns"], style: STYLE.header },
			...doc.tables.map((t, i) => ({ cells: [String(i + 1), t.physicalName, t.logicalName, String(t.columns.length)], style: STYLE.cell })),
		],
	};
	const sheets = [summary];
	for (const table of doc.tables) {
		const rows: Sheet["rows"] = [
			{ cells: [tableTitle(table)], style: STYLE.title },
			{ cells: [], style: STYLE.normal },
			{ cells: COLUMN_HEADER, style: STYLE.header },
			...table.columns.map((column, i) => ({ cells: columnRow(column, i), style: STYLE.cell })),
		];
		if (table.indexes.length) {
			rows.push({ cells: [], style: STYLE.normal }, { cells: ["Index", "Columns", "Unique"], style: STYLE.header });
			rows.push(...table.indexes.map(i => ({ cells: [i.name, i.fields, yn(!!i.unique)], style: STYLE.cell })));
		}
		if (table.checks.length) {
			rows.push({ cells: [], style: STYLE.normal }, { cells: ["Check", "Expression"], style: STYLE.header });
			rows.push(...table.checks.map(c => ({ cells: [c.name, c.expression], style: STYLE.cell })));
		}
		sheets.push({ name: sheetName(table.physicalName, used), widths: [6, 24, 30, 18, 16, 5, 5, 5, 5, 30], rows });
	}
	if (doc.relations.length) {
		sheets.push({
			name: sheetName("Relationships", used),
			widths: [30, 24, 30, 24, 30, 12, 12],
			rows: [{ cells: RELATION_HEADER, style: STYLE.header }, ...doc.relations.map(r => ({ cells: relationRow(r), style: STYLE.cell }))],
		});
	}
	return sheets;
}

export function toXlsx(doc: TableDocument): Uint8Array {
	const sheets = makeSheets(doc);
	const files: Record<string, Uint8Array> = {};
	const sheetPath = (i: number) => `xl/worksheets/sheet${i + 1}.xml`;

	files["[Content_Types].xml"] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${
		sheets.map((_s, i) => `<Override PartName="/${sheetPath(i)}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`);
	files["_rels/.rels"] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
	files["xl/workbook.xml"] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${
		sheets.map((s, i) => `<sheet name="${xml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`);
	files["xl/_rels/workbook.xml.rels"] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${
		sheets.map((_s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")
	}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
	files["xl/styles.xml"] = strToU8(STYLES_XML);
	sheets.forEach((sheet, i) => { files[sheetPath(i)] = strToU8(sheetXML(sheet)); });

	return zipSync(files);
}
