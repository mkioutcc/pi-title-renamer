import assert from "node:assert/strict";
import { test } from "node:test";
import { sanitizeTitle } from "../extensions/title-renamer/sanitize.ts";

test("sanitizeTitle takes first valid line and removes wrapping quotes", () => {
	const result = sanitizeTitle('"標籤命名"\n其他候選', { maxChars: 24 });
	assert.equal(result.ok, true);
	assert.equal(result.title, "標籤命名");
});

test("sanitizeTitle removes markdown markers", () => {
	const result = sanitizeTitle("### **[pi-config｜標籤命名](https://example.invalid)**", { maxChars: 24 });
	assert.equal(result.ok, true);
	assert.equal(result.title, "pi-config｜標籤命名");
});

test("sanitizeTitle removes ANSI and control characters", () => {
	const result = sanitizeTitle("\u001b[31m危險\u001b[0m\u0007標題", { maxChars: 24 });
	assert.equal(result.ok, true);
	assert.equal(result.title, "危險標題");
});

test("sanitizeTitle removes embedded quotes and backticks", () => {
	const result = sanitizeTitle("`標`籤'命名'", { maxChars: 24 });
	assert.equal(result.ok, true);
	assert.equal(result.title, "標籤命名");
});

test("sanitizeTitle truncates by unicode code point", () => {
	const result = sanitizeTitle("abcdef", { maxChars: 4 });
	assert.equal(result.ok, true);
	assert.equal(result.title, "abcd");
});

test("sanitizeTitle fails when only markdown fence remains", () => {
	const result = sanitizeTitle("```\n```", { maxChars: 24 });
	assert.equal(result.ok, false);
});
