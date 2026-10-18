const COLOR = /^#[0-9a-fA-F]{6}$/;

/** SVG 속성으로 그대로 들어가므로 #rrggbb 형식만 허용 */
export function toColor(value: unknown): string | undefined {
	return typeof value === "string" && COLOR.test(value) ? value.toLowerCase() : undefined;
}
