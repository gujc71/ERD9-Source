import { tableTitle, toDocColumn } from "../export/tableDocModel";
import type { RelationDoc, TableDoc } from "../export/tableDocModel";
import type { FieldData } from "../types";

export const diagramUtil = {
  // copy field from parent
  copyNewFK (sourceField: FieldData, parent: string): FieldData {
    const newObj = { ...sourceField };
    newObj.id = "f" + this.getUniqueID();
    newObj.parent = parent;
    newObj.parentID = sourceField.id;
    delete newObj.isPK;

    return newObj;
  },

  deepCopy<T> (obj: T): T {
    if (obj === null || typeof obj !== 'object') {
        return obj;
    }

    if (Array.isArray(obj)) {
        return obj.map(item => this.deepCopy(item)) as T;
    }

    const copy: Record<string, unknown> = {};
    for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
            copy[key] = this.deepCopy(obj[key]);
        }
    }
    return copy as T;
  },

  /** 충돌하지 않는 id (DOM id, CSS 선택자에 그대로 쓸 수 있도록 영숫자만) */
  getUniqueID(): string {
    return crypto.randomUUID().replace(/-/g, "");
  },

  getUniqueValue(inputString: string): string {
    // 정규 표현식을 사용하여 문자열에서 숫자 부분을 추출
    const matches = inputString.match(/_(\d+)$/);

    // 숫자가 발견되면 값을 증가시키고 다음 값을 반환
    if (matches) {
        return inputString.replace(matches[0], "_" + (parseInt(matches[1]) + 1));
    }
    // 숫자가 없다면 "_1"을 추가하여 반환
    return inputString + "_1";
  },

  /** withDomain: 마지막에 도메인 컬럼 추가 (엔터티 편집 그리드) */
  createTable(parent: Node, classname?: string, withDomain = false): HTMLTableSectionElement {
    const columns = ['Column Name', 'Attribute Name', 'Data Type', 'Default', 'PK', 'UQ', 'NN', 'AI'];
    const widths = ['150px', '150px', '100px', '100px', '30px', '30px', '30px', '30px'];
    const hints: (string | null)[] = [null, null, null, null, 'Primary Key', 'Unique Constraint', 'Not Null', 'Auto Increment'];
    if (withDomain) {
      columns.push('Domain');
      widths.push('90px');
      hints.push('Data type, default and not null come from the domain');
    }

    const table = this.createHTMLElement(parent, "table");

    const thead = this.createHTMLElement(table, "thead");
    const tr = this.createHTMLElement(thead, "tr");

    columns.forEach((column, inx) => {
      const th = this.createHTMLElement(tr, "th", null, column);
      th.style.width = widths[inx];
      const hint = hints[inx];
      if (hint) th.title = hint;
    });

    return this.createHTMLElement(table, "tbody", classname);
  },

  /** 셀 값은 텍스트로 넣는다. HTML이 필요한 셀은 Node를 전달 */
  addTableRow(parentNode: Node, tag: "td" | "th", columns: (string | Node | null | undefined)[], sizes?: string[] | null, css?: (string | null)[]): HTMLTableRowElement {
    const row1 = document.createElement("tr");
    columns.forEach((columnData, index) => {
      const cell1 = document.createElement(tag);
      if (columnData instanceof Node) cell1.appendChild(columnData);
      else cell1.textContent = columnData ?? "";
      row1.appendChild(cell1);
      if (sizes) cell1.style.width = sizes[index];
      const cssName = css?.[index];
      if (cssName) cell1.classList.add(cssName);
    });
    parentNode.appendChild(row1);
    return row1;
  },

  /** 요소 생성. text는 HTML로 해석하지 않는다 */
  createHTMLElement<K extends keyof HTMLElementTagNameMap>(parentNode: Node, tag: K, className?: string | null, text?: string | null): HTMLElementTagNameMap[K] {
    const newEle = document.createElement(tag);
    parentNode.appendChild(newEle);

    if (className) newEle.className = className;
    if (text) newEle.textContent = text;

    return newEle;
  },

  /** HTML 문자열을 직접 만들어야 할 때 값 이스케이프 */
  escapeHTML(value?: string | number | null): string {
    return String(value ?? "").replace(/[&<>"']/g, ch => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"})[ch]!);
  },

  /** 두 요소의 내용(자식 노드) 맞바꾸기 */
  changeValue(value1: HTMLElement, value2: HTMLElement): void {
    const nodes1 = [...value1.childNodes];
    value1.replaceChildren(...value2.childNodes);
    value2.replaceChildren(...nodes1);
  },

  /** 테이블 정의 출력 (keys는 PK로 표시). renderTableDoc 참고 */
  makeTableDesc(logPrinter: Node, tableData: { physicalName: string; logicalName?: string; keys?: FieldData[]; fields: FieldData[] }): void {
    this.renderTableDoc(logPrinter, {
      physicalName: tableData.physicalName,
      logicalName: tableData.logicalName ?? "",
      columns: [...(tableData.keys ?? []).map(field => toDocColumn(field, { pk: true })), ...tableData.fields.map(field => toDocColumn(field))],
      indexes: [],
      checks: [],
    });
  },

  /**
   * 테이블 정의(제목, 컬럼, 인덱스, CHECK)를 화면용 표로 출력.
   * 테이블 정의서, DDL 가져오기 미리보기, AI ERD 결과가 함께 사용한다.
   */
  renderTableDoc(parent: Node, table: TableDoc): void {
    const yn = (value: boolean) => value ? "Y" : "";
    this.createHTMLElement(parent, "h4", "tableName-span", tableTitle(table));

    const tbody = this.createTable(parent);
    for (const column of table.columns) {
      this.addTableRow(tbody, "td", [column.column, column.comment, column.dataType, column.defaultValue,
                                     yn(column.pk), yn(column.unique), yn(column.notNull), yn(column.ai)]);
    }
    if (table.indexes.length) {
      const indexTable = this.createHTMLElement(parent, "table");
      this.addTableRow(indexTable, "th", ["Index Name", "Columns", "Unique"]);
      for (const index of table.indexes) this.addTableRow(indexTable, "td", [index.name, index.fields, yn(!!index.unique)]);
    }
    if (table.checks.length) {
      const checkTable = this.createHTMLElement(parent, "table");
      this.addTableRow(checkTable, "th", ["Check", "Expression"]);
      for (const check of table.checks) this.addTableRow(checkTable, "td", [check.name, check.expression]);
    }
  },

  /** 관계 목록을 화면용 표로 출력. 관계가 없으면 출력하지 않는다. widths: 헤더 열 너비 */
  renderRelationDocs(parent: Node, relations: RelationDoc[], widths?: string[]): void {
    if (relations.length === 0) return;
    this.createHTMLElement(parent, "h4", "tableName-span", "Relationships");
    const table = this.createHTMLElement(parent, "table");
    this.addTableRow(table, "th", ["FK Name", "Table", "Columns", "References", "Columns", "On Delete", "On Update"], widths);
    for (const relation of relations) {
      this.addTableRow(table, "td", [relation.name, relation.childTable, relation.childFields, relation.parentTable, relation.parentFields, relation.onDelete, relation.onUpdate]);
    }
  }
};
