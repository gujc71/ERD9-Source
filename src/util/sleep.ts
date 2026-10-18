export async function sleep(ms: number): Promise<void> {
	await new Promise(resolve => setTimeout(resolve, ms));
}

const now = (): number => typeof performance !== "undefined" ? performance.now() : Date.now();

/**
 * 시간 분할(time slicing): 긴 반복 작업 중 호출하면, 마지막으로 양보한 뒤 budgetMs가 지났을 때만 이벤트 루프에 양보한다.
 * 고정 지연(sleep) 대신 사용해 화면 갱신은 유지하면서 불필요한 대기를 없앤다.
 * onYield: 양보하기 직전에 실행 (로그 출력, 스크롤 등 화면 반영을 한 번에)
 */
export function createYielder(budgetMs = 16, onYield?: () => void): () => Promise<void> {
	let last = now();
	return async () => {
		if (now() - last < budgetMs) return;
		onYield?.();
		await new Promise(resolve => setTimeout(resolve, 0));
		last = now();
	};
}
