import { select, selectAll } from "d3-selection";
import type { DbmsType } from "./constants";
import { getConverter, getDomain } from "./standard/applyStandards";
import { docObjects, state } from "./state";
import type { CheckData, DomainObject, EntityData, FieldData, IndexData, Sel, StdTerm } from "./types";
import { dataTypeUtil } from "./util/dataTypeUtil";
import { diagramUtil } from "./util/diagramUtil";

/** 그리드 컬럼 위치 */
const NN_CELL = 6;
const DOMAIN_CELL = 8;

function deleteIcon(): HTMLSpanElement {
  const icon = document.createElement("span");
  icon.className = "delete-icon";
  icon.textContent = "x ";
  return icon;
}

/** 인덱스 목록 항목 내용: 삭제 아이콘 + "이름 (컬럼)" */
export function setIndexItem(li: HTMLLIElement, data: IndexData): void {
  li.replaceChildren(deleteIcon(), ` ${data.name} (${data.fields})${data.unique ? " UNIQUE" : ""}`);
}

/** CHECK 제약 목록 항목 내용: 삭제 아이콘 + "이름: 조건식" */
export function setCheckItem(li: HTMLLIElement, data: CheckData): void {
  li.replaceChildren(deleteIcon(), ` ${data.name}: ${data.expression}`);
}

/** 엔터티 수정 다이얼로그의 컬럼 편집 그리드 */
export class TableGrid9 {
  private selectedRow: HTMLTableRowElement | null = null;
  private dbms: DbmsType;
  private tbody: Sel<HTMLTableSectionElement>;
  /** Data Type 셀 편집 중 입력값으로 걸러 보여주는 타입 목록 */
  private typeList: HTMLUListElement;
  private dataTypes: Record<string, string> = {};
  private typeActive = -1;
  /** 마지막 컬럼에 도메인 표시 (diagramUtil.createTable(..., true)로 만든 표) */
  private withDomain: boolean;

  constructor(tbody: Sel<HTMLTableSectionElement>, data: EntityData | null, dbms: DbmsType, withDomain = false) {
    this.dbms = dbms;
    this.tbody = tbody;
    this.withDomain = withDomain;

    tbody.on('click', this.handleCellClick.bind(this));
    // NOT NULL을 직접 바꾸면 도메인 연결을 끊는다
    tbody.on('change', (event: Event) => {
      const input = event.target as HTMLElement;
      const cell = input.parentNode;
      if (input instanceof HTMLInputElement && input.type === "checkbox" && cell instanceof HTMLTableCellElement && cell.cellIndex === NN_CELL) {
        this._detachDomain(cell.parentNode as HTMLTableRowElement);
      }
    });
    state.nameEditor.setWorkTable(tbody.node()!);
    state.nameEditor.onCellEdit = this._onNameEdited.bind(this);
    state.nameEditor.onTermSelect = (tr, term) => this._applyTermDomain(tr, term, true);

    const container = tbody.node()!.parentNode!.parentNode as HTMLElement;
    this.typeList = document.createElement("ul");
    this.typeList.className = "typeList";
    container.appendChild(this.typeList);
    // 목록을 눌러도 입력 상자의 포커스를 잃지 않도록
    this.typeList.addEventListener("mousedown", (event) => event.preventDefault());
    container.addEventListener("scroll", () => this._hideTypeList());

    this.dataTypes = dataTypeUtil.getDataTypes(this.dbms);

    if (data) this.setTableData(data, dbms); else this._setEmptyRows(5);
  }

  /* ---------------------------------------------------------------------------------
   * Data Type 자동완성 목록
   */
  private _hideTypeList(): void {
    this.typeList.style.display = "none";
    this.typeActive = -1;
  }

  /**
   * 입력값으로 시작하는 타입만 보여준다. 자릿수를 입력 중이면 닫는다.
   * all: 걸러내지 않고 전체를 보여주며 현재 타입을 고른 상태로 (편집 시작, ↓ 키)
   */
  private _showTypeList(input: HTMLInputElement, onPick: (name: string) => void, all = false): void {
    const raw = input.value.trim().toUpperCase();
    if (!all && raw.includes("(")) { this._hideTypeList(); return; }
    const value = raw.replace(/\s*\(.*$/, "");

    const names = Object.keys(this.dataTypes).filter(name => all || name.startsWith(value));
    if (names.length === 0) { this._hideTypeList(); return; }

    this.typeList.replaceChildren(...names.map(name => {
      const li = document.createElement("li");
      li.textContent = name;
      if (this.dataTypes[name] === "Y") {
        const hint = document.createElement("span");
        hint.textContent = "(n)";
        li.appendChild(hint);
      }
      li.addEventListener("click", () => onPick(name));
      return li;
    }));
    // 입력한 값과 같은 타입, 없으면 입력 중일 때 첫 항목을 고른 상태로
    const exact = names.indexOf(value);
    this._setTypeActive(exact >= 0 ? exact : value && !all ? 0 : -1);

    const rect = (input.parentNode as HTMLElement).getBoundingClientRect();
    this.typeList.style.top = rect.bottom + "px";
    this.typeList.style.left = rect.left + "px";
    this.typeList.style.minWidth = rect.width + "px";
    this.typeList.style.display = "block";
  }

  private _setTypeActive(index: number): void {
    const items = this.typeList.children;
    items[this.typeActive]?.classList.remove("active");
    this.typeActive = index;
    items[index]?.classList.add("active");
    items[index]?.scrollIntoView({ block: "nearest" });
  }

  /** 목록 키보드 조작. 처리했으면 true */
  private _typeListKey(event: KeyboardEvent, input: HTMLInputElement, onPick: (name: string) => void): boolean {
    const visible = this.typeList.style.display === "block";
    const count = this.typeList.children.length;
    switch (event.key) {
      case "ArrowDown":
        if (!visible) this._showTypeList(input, onPick, true);
        else this._setTypeActive((this.typeActive + 1) % count);
        break;
      case "ArrowUp":
        if (!visible) return false;
        this._setTypeActive((this.typeActive - 1 + count) % count);
        break;
      case "Enter":
        if (!visible || this.typeActive < 0) return false;
        onPick(this.typeList.children[this.typeActive].firstChild!.textContent!);
        break;
      case "Escape":
        if (!visible) return false;
        this._hideTypeList();
        break;
      default:
        return false;
    }
    event.preventDefault();
    event.stopPropagation();
    return true;
  }

  /* ---------------------------------------------------------------------------------
   * 도메인
   */
  private _setRowDomain(tr: HTMLTableRowElement, domain: DomainObject): void {
    tr.setAttribute("data-domain", domain.id);
    tr.cells[2].innerText = domain.dataType;
    tr.cells[3].innerText = domain.defaultValue === undefined ? "" : String(domain.defaultValue);
    const notNull = tr.cells[NN_CELL].querySelector("input")!;
    const isPK = tr.cells[4].querySelector("input")!.checked;
    notNull.checked = !!domain.notNull || (isPK && notNull.checked);
    if (this.withDomain) tr.cells[DOMAIN_CELL].innerText = domain.name;
  }

  /** 타입, 기본값, NOT NULL을 직접 바꾸면 도메인을 따르지 않는다 */
  private _detachDomain(tr: HTMLTableRowElement): void {
    if (!tr.getAttribute("data-domain")) return;
    tr.removeAttribute("data-domain");
    if (this.withDomain) tr.cells[DOMAIN_CELL].innerText = "";
  }

  /** 도메인 셀: 선택 상자 */
  private _editDomain(cell: HTMLTableCellElement): void {
    if (cell.querySelector("select")) return;
    const tr = cell.parentNode as HTMLTableRowElement;
    const current = tr.getAttribute("data-domain") ?? "";
    const selectBox = document.createElement("select");
    selectBox.className = "input-cell";
    selectBox.add(new Option("", ""));
    for (const domain of [...docObjects.domains].sort((a, b) => a.name.localeCompare(b.name))) {
      selectBox.add(new Option(`${domain.name} (${domain.dataType})`, domain.id, false, domain.id === current));
    }
    const close = () => {
      const domain = getDomain(selectBox.value);
      selectBox.remove();
      if (domain) this._setRowDomain(tr, domain);
      else {
        this._detachDomain(tr);
        cell.innerText = "";
      }
    };
    cell.textContent = "";
    cell.appendChild(selectBox);
    selectBox.addEventListener("change", () => selectBox.blur());
    selectBox.addEventListener("blur", close);
    selectBox.focus();
  }

  /* ---------------------------------------------------------------------------------
   * 표준 이름: 주석(논리명)을 입력하면 컬럼명을, 컬럼명을 입력하면 주석을 채운다 (비어 있을 때만)
   */
  private _onNameEdited(cell: HTMLTableCellElement): void {
    const tr = cell.parentNode as HTMLTableRowElement | null;
    if (!tr || tr.parentNode !== this.tbody.node() || tr.getAttribute("data-parent")) return;
    const converter = getConverter();
    if (converter.isEmpty) return;

    const value = cell.innerText.trim();
    if (!value) return;
    if (cell.cellIndex === 1 && tr.cells[0].innerText.trim() === "") {
      const result = converter.toPhysical(value);
      if (result.unknown.length === 0) tr.cells[0].innerText = result.physical;
      this._applyTermDomain(tr, result.term);
    } else
    if (cell.cellIndex === 0 && tr.cells[1].innerText.trim() === "") {
      const result = converter.toLogical(value);
      if (result.unknown.length === 0) tr.cells[1].innerText = result.logical;
      this._applyTermDomain(tr, result.term);
    }
  }

  /** 용어에 도메인이 있으면 적용. force가 아니면 타입을 아직 정하지 않았거나 도메인이 없는 경우만 */
  private _applyTermDomain(tr: HTMLTableRowElement, term?: StdTerm, force = false): void {
    const domain = getDomain(term?.domain);
    if (domain && (force || tr.cells[2].innerText.trim() === "" || !tr.getAttribute("data-domain"))) this._setRowDomain(tr, domain);
  }

  /** 모든 컬럼(FK 제외)에 표준 이름 적용. 바꾼 컬럼 수와 사전에 없는 단어 반환 */
  applyStandardNames(): { changed: number; unknown: string[] } {
    const converter = getConverter();
    const unknown = new Set<string>();
    let changed = 0;
    this.tbody.selectAll<HTMLTableRowElement, unknown>("tr").each((_d, i, rows) => {
      const tr = rows[i];
      const comment = tr.cells[1].innerText.trim();
      if (!comment || tr.getAttribute("data-parent")) return;
      const result = converter.toPhysical(comment);
      if (result.unknown.length > 0) {
        result.unknown.forEach(word => unknown.add(word));
        return;
      }
      const domain = getDomain(result.term?.domain);
      if (tr.cells[0].innerText.trim() !== result.physical || (domain && tr.getAttribute("data-domain") !== domain.id)) changed++;
      tr.cells[0].innerText = result.physical;
      if (domain) this._setRowDomain(tr, domain);
    });
    return { changed, unknown: [...unknown] };
  }

  rowActionHandle(event: MouseEvent): void {
    this._hideTypeList();

    const src = event.target as HTMLElement;
    if (!this.selectedRow && src.innerText!=="+") return;

    if (src.innerText==="↑") {    // move up
        const row = this.selectedRow!;
        row.parentNode!.insertBefore(row, row.previousElementSibling);
    } else
    if (src.innerText==="↓") { // move down
        const row = this.selectedRow!;
        if (row.nextElementSibling) row.parentNode!.insertBefore(row.nextElementSibling, row);
    } else
    if (src.innerText==="+") { // insert
      if (this.selectedRow) {
        const tbody = this.selectedRow.parentNode as HTMLTableSectionElement;
        this._appendTableRow(select(tbody.insertRow(this.selectedRow.rowIndex)), {}, false);
      } else {
        this._appendTableRow(this.tbody.append("tr"), {}, false);
      }
    } else
    if (src.innerText==="-") {    // delete
        const row = this.selectedRow!;
        // can not remove if field is FK
        if (row.getAttribute('data-parent')) return;

        (row.parentNode as HTMLTableSectionElement).deleteRow(row.rowIndex-1);
        this.selectedRow = null;
    }
  }

  private _setEmptyRows(rowCount: number): void {
    for (let i = 0; i < rowCount; i++) {
        this._appendTableRow(this.tbody.append("tr"), {}, false);
    }
  }

  setTableData(data: EntityData, dbms: DbmsType): void {
    this.selectedRow = null;
    this._hideTypeList();

    if (this.dbms!==dbms) {
      this.dbms=dbms;
      this.dataTypes = dataTypeUtil.getDataTypes(this.dbms);
    }

    this.tbody.style("user-select", "none");
    this.tbody.selectAll("tr").remove();

    data.keys.forEach((field) => {
        this._appendTableRow(this.tbody.append("tr"), field, true);
    });
    data.fields.forEach((field) => {
        this._appendTableRow(this.tbody.append("tr"), field, false);
    });

    if (data.keys.length+data.fields.length===0 )
      this._appendTableRow(this.tbody.append("tr"), {}, false);

    selectAll(".tableindexList li").remove();
    select(".tableindexList").selectAll("li")
          .data(data.indexes ?? [])
          .enter()
          .append("li")
          .attr("id", function(d) {return "inx" + d.name})
          .each(function(d) { setIndexItem(this, d); });

    selectAll(".tablecheckList li").remove();
    select(".tablecheckList").selectAll("li")
          .data(data.checks ?? [])
          .enter()
          .append("li")
          .each(function(d) { setCheckItem(this, d); });
  }

  /** 템플릿 컬럼 추가. 이미 있는 컬럼명은 건너뛴다. 추가된 컬럼 수 반환 */
  appendFields(fields: Partial<FieldData>[]): number {
    const existing = new Set<string>();
    this.tbody.selectAll<HTMLTableRowElement, unknown>("tr").each(function() {
      existing.add(this.cells[0].innerText.trim().toUpperCase());
    });
    // 내용이 없는 빈 행은 지우고 그 자리에 추가
    this.tbody.selectAll<HTMLTableRowElement, unknown>("tr").filter(function() { return this.cells[0].innerText.trim()===""; }).remove();
    this.selectedRow = null;

    let count = 0;
    for (const field of fields) {
      if (!field.column || existing.has(field.column.toUpperCase())) continue;
      this._appendTableRow(this.tbody.append("tr"), field, false);
      count++;
    }
    return count;
  }

  private _appendTableRow(tr: Sel<HTMLTableRowElement>, field: Partial<FieldData>, isKey: boolean): void {
      tr.attr('data-id', field.id ?? null);

      tr.append("td").text(field.column ?? "");
      tr.append("td").text(field.comment ?? "");
      tr.append("td").text(field.dataType ?? "");
      tr.append("td").text(field.defaultValue ?? "");

      const keyIn = tr.append("td").style("padding-left", "8px").append("input").attr("type", "checkbox");
      if (isKey) keyIn.attr("checked", "checked");

      const uniqueKey = tr.append("td").style("padding-left", "8px").append("input").attr("type", "checkbox");
      if (field.uniqueKey) uniqueKey.attr("checked", "checked");

      const notNull = tr.append("td").style("padding-left", "8px").append("input").attr("type", "checkbox");
      if (field.notNull) notNull.attr("checked", "checked");

      const ai = tr.append("td").style("padding-left", "8px").append("input").attr("type", "checkbox");
      if (field.ai) ai.attr("checked", "checked");

      const domain = getDomain(field.domain);
      if (domain) tr.attr("data-domain", domain.id);
      if (this.withDomain) tr.append("td").text(domain?.name ?? "");

      // FK field cannot be modified.
      if (field.parent) {
        tr.attr('data-parent', field.parent);
        tr.attr('data-parentID', field.parentID ?? null);
        keyIn.attr('disabled', 'disabled');
        uniqueKey.attr('disabled', 'disabled');
        notNull.attr('disabled', 'disabled');
        ai.attr('disabled', 'disabled');
      }
  }

  handleCellClick(event: MouseEvent): void {
    this._hideTypeList();

    const cell = event.target as HTMLElement;
    if (!(cell instanceof HTMLTableCellElement)) return;

    // row(tr) select
    if (this.selectedRow) this.selectedRow.classList.remove("selectRow");
    this.selectedRow = cell.parentNode as HTMLTableRowElement;
    this.selectedRow.classList.add("selectRow");

    // can not modify if field is FK
    if (this.selectedRow.getAttribute('data-parent')) {
        return;
    }
    if (cell.cellIndex <2) return;
    if (this.withDomain && cell.cellIndex === DOMAIN_CELL) {
      this._editDomain(cell);
      return;
    }

    const cell4d3 = select(cell);

    // other column : : input box
    const inputBox = cell4d3.select("input");
    if (inputBox.size() > 0) return;

    const cell4d3Value = cell4d3.text();
    cell4d3.text("");

    const isType = cell.cellIndex===2;
    const closeInput = (event: Event) => {
        const input = event.target as HTMLInputElement;
        const parent = input.parentNode as HTMLTableCellElement | null;
        if (!parent) return;
        if (isType) this._hideTypeList();
        parent.innerText = input.value;
        input.remove();
        // 타입, 기본값을 직접 바꾸면 도메인을 따르지 않음
        if (input.value !== cell4d3Value) this._detachDomain(parent.parentNode as HTMLTableRowElement);
    };
    const inputElement = cell4d3.append("input")
      .attr("type", "text")
      .attr("class", "input-cell")
      .property("value", cell4d3Value)
      .on("blur", closeInput);
    const input = inputElement.node()!;

    // Data Type: 자릿수가 필요한 타입은 괄호 안에 커서를 두고 계속 입력, 아니면 바로 확정
    const pickType = (name: string) => {
      const current = input.value.trim().toUpperCase();
      if (this.dataTypes[name] === "Y") {
        // 자릿수까지 입력된 같은 타입이면 그대로 확정
        if (/^\S+\s*\(.+\)$/.test(current) && current.replace(/\s*\(.*$/, "") === name) { input.blur(); return; }
        input.value = name + "()";
        const pos = input.value.indexOf("(") + 1;
        input.setSelectionRange(pos, input.value.length - 1);
        this._hideTypeList();
      } else {
        input.value = name;
        input.blur();
      }
    };

    inputElement
      .on("keydown", (event: KeyboardEvent) => {
        if (isType && this._typeListKey(event, input, pickType)) return;
        if (event.key === "Escape") {     // 편집 취소
          event.stopPropagation();
          input.value = cell4d3Value;
          input.blur();
        } else
        if (event.key === "Enter") input.blur();
      })
      .on("input", () => {
        if (isType) this._showTypeList(input, pickType);
      });

    input.select();
    input.focus(); // 입력 상자에 포커스 설정

    if (isType) this._showTypeList(input, pickType, true);
  }

  // grid to json
  getTableData(): EntityData {
    const keys: FieldData[] = [];
    const fields: FieldData[] = [];
    this.tbody.selectAll<HTMLTableRowElement, unknown>("tr").each(function() {
        const cells = this.cells;
        const column = cells[0].innerText.trim();
        if (column==="") return;

        const defaultText = cells[3].innerText.trim();

        const id = this.getAttribute('data-id');
        const fieldInfo: FieldData = {
          id: id ? id : "f" + diagramUtil.getUniqueID(),
          column: column,
          comment: cells[1].innerText.trim(),
          dataType: cells[2].innerText.trim(),
          // 숫자면 숫자로, 아니면(CURRENT_TIMESTAMP 등) 문자열 그대로
          defaultValue: defaultText && !isNaN(Number(defaultText)) ? Number(defaultText) : defaultText,
          parent: this.getAttribute('data-parent'),
          parentID: this.getAttribute('data-parentID'),
          uniqueKey: (cells[5].querySelector('input[type="checkbox"]') as HTMLInputElement).checked,
          notNull: (cells[6].querySelector('input[type="checkbox"]') as HTMLInputElement).checked,
          ai: (cells[7].querySelector('input[type="checkbox"]') as HTMLInputElement).checked,
        };
        const domain = this.getAttribute('data-domain');
        if (domain) fieldInfo.domain = domain;

        if ((cells[4].querySelector('input[type="checkbox"]') as HTMLInputElement).checked) {
               fieldInfo.isPK = true;
               keys.push (fieldInfo);
        } else fields.push (fieldInfo);

    });

    const indexes: IndexData[] = [];
    selectAll<HTMLLIElement, IndexData>(".tableindexList li").each(function(d) {
      indexes.push(d);
    });
    const checks: CheckData[] = [];
    selectAll<HTMLLIElement, CheckData>(".tablecheckList li").each(function(d) {
      checks.push(d);
    });

    return {physicalName: "", keys: keys, fields: fields, indexes: indexes, checks: checks};
  }
}
