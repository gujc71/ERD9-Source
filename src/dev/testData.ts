/** 개발 모드(npm run dev)에서만 로드되는 테스트 데이터 */
import { DIAGRAM_TYPE } from "../constants";
import { Entity9 } from "../diagram/Entity9";
import { Relation9 } from "../diagram/Relation9";
import { Text9 } from "../diagram/Text9";
import { state } from "../state";
import { diagramUtil } from "../util/diagramUtil";

export function setTestData(): void {
	const canvas = state.canvas;
	const fid = () => "f" + diagramUtil.getUniqueID();

	new Text9(canvas, 400, 150, null, "ERD9");

	const e1 = new Entity9(canvas, 400, 200);
	const e2 = new Entity9(canvas, 700, 50);
	const e3 = new Entity9(canvas, 800, 350);
	new Entity9(canvas, 100, 50);
	const e5 = new Entity9(canvas, 100, 400);

	e1.setData({
		physicalName: "aaaa",
		logicalName: "테이블1",
		keys: [ {id: fid(), column: 'column1', dataType: 'TINYINT', defaultValue: '', notNull: false, isPK:true},
				{id: fid(), column: 'column2', dataType: 'VARCHAR(10)', defaultValue: 1, notNull: false},
				{id: fid(), column: 'column3', comment: '키필드 3', dataType: 'VARCHAR(10)', defaultValue: '', notNull: false}
		],
		fields:[{id: fid(), column: 'column4', comment: '키필드 4', dataType: 'VARCHAR(10)', defaultValue: 1, notNull: false},
				{id: fid(), column: 'column5', comment: '키필드 5', dataType: 'TINYTEXT', defaultValue: '', notNull: false}
		]
	});
	e2.setData({
		physicalName: "bbbb",
		logicalName: "테이블2",
		keys: [{id: fid(), column: 'column1', comment: '키필드 1', dataType: 'DECIMAL(3,0)', defaultValue: '', notNull: false, isPK:true}],
		fields: [{id: fid(), column: 'column2', comment: '필드 4', dataType: 'VARCHAR(10)', defaultValue: '', notNull: false },
				{id: fid(), column: 'column5', comment: '필드 5', dataType: 'VARCHAR(10)', defaultValue: '', notNull: false },
				{id: fid(), column: 'column6', comment: '필드 6', dataType: 'VARCHAR(10)', defaultValue: '', notNull: false },
				{id: fid(), column: 'column7', comment: '필드 글 길미 체크7', dataType: 'VARCHAR(10)', defaultValue: '', notNull: false },
				{id: fid(), column: 'column8', comment: 'aaaaaaa필드 8', dataType: 'VARCHAR(10)', defaultValue: '', notNull: false },
				{id: fid(), column: 'column9', comment: '필드 9', dataType: 'VARCHAR(10)', defaultValue: '', notNull: false },
				{id: fid(), column: 'column10', comment: '필드 10', dataType: 'VARCHAR(10)', defaultValue: '', notNull: false },
				{id: fid(), column: 'column11', comment: '필드 11', dataType: 'VARCHAR(10)', defaultValue: '', notNull: false },
				{id: fid(), column: 'column12', comment: '필드 12한글 길미 체크', dataType: 'VARCHAR(10)', defaultValue: '', notNull: false }
		],
		indexes:[
			{name: "a1dddddddddddddd1", fields: "column1,column2"}
		]
	});
	e5.setData({
		physicalName: "cccc",
		logicalName: "테이블1ccc",
		keys: [ {id: fid(), column: 'column1', comment: '키필드 1', dataType: 'TINYINT', defaultValue: '', notNull: false, isPK:true}
		],
		fields:[]
	});

	Relation9.create(canvas, e1, e3, true, DIAGRAM_TYPE.RELATION_AK);
	Relation9.create(canvas, e2, e1, true, DIAGRAM_TYPE.RELATION_PK);
}
