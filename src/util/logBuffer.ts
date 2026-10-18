/**
 * 로그 출력 버퍼. 줄마다 DOM에 추가하고 스크롤하면(강제 레이아웃) 로그가 길어질수록 느려지므로,
 * DocumentFragment에 모았다가 프레임마다(또는 flush 호출 시) 한 번에 추가하고 한 번만 스크롤한다.
 */
export class LogBuffer {
	private fragment: DocumentFragment | null = null;
	private scheduled = false;

	constructor(readonly target: HTMLElement) {}

	/** 요소를 버퍼에 추가 (다음 프레임에 화면에 반영) */
	add<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text: string): HTMLElementTagNameMap[K] {
		const element = document.createElement(tag);
		element.className = className;
		if (text) element.textContent = text;
		(this.fragment ??= document.createDocumentFragment()).appendChild(element);
		this.schedule();
		return element;
	}

	/** 모은 내용을 화면에 반영하고 마지막으로 스크롤 */
	flush(): void {
		if (!this.fragment) return;
		this.target.appendChild(this.fragment);
		this.fragment = null;
		this.target.scrollTop = this.target.scrollHeight;
	}

	private schedule(): void {
		if (this.scheduled) return;
		this.scheduled = true;
		const run = () => {
			this.scheduled = false;
			this.flush();
		};
		if (typeof requestAnimationFrame === "function") requestAnimationFrame(run);
		else setTimeout(run, 16);
	}
}
