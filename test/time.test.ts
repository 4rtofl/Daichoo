import { describe, expect, it } from "vitest";
import {
	formatJst,
	isMonth,
	monthLabel,
	monthOf,
	previousMonth,
	snowflakeToDate,
} from "../src/time.ts";
import { snowflakeAt } from "./helpers.ts";

describe("snowflakeToDate", () => {
	it("Discordの文書にあるIDから、作られた時刻を取り出す", () => {
		expect(snowflakeToDate("175928847299117063").toISOString()).toBe(
			"2016-04-30T11:18:25.796Z",
		);
	});

	it("テスト用に作ったIDとも、時刻が合う", () => {
		expect(snowflakeToDate(snowflakeAt("2026-11-13T13:38:58Z"))).toEqual(
			new Date("2026-11-13T13:38:58Z"),
		);
	});
});

describe("monthOf", () => {
	it("日本時間で月を決める", () => {
		// UTCでは10月31日だが、日本時間では11月1日の0時
		expect(monthOf(new Date("2026-10-31T15:00:00Z"))).toBe("2026-11");
		expect(monthOf(new Date("2026-10-31T14:59:59Z"))).toBe("2026-10");
	});
});

describe("previousMonth", () => {
	it("1月の前は、前の年の12月", () => {
		expect(previousMonth("2027-01")).toBe("2026-12");
		expect(previousMonth("2026-11")).toBe("2026-10");
	});

	it("形が正しくなければエラーにする", () => {
		expect(() => previousMonth("2026-13")).toThrowError();
	});
});

describe("ほかの日時の書き方", () => {
	it("日本時間のISO 8601で書く", () => {
		expect(formatJst(new Date("2026-11-13T13:38:58.123Z"))).toBe(
			"2026-11-13T22:38:58+09:00",
		);
	});

	it("月を表示用に書く", () => {
		expect(monthLabel("2026-01")).toBe("2026年1月");
	});

	it("月の形を確かめる", () => {
		expect(isMonth("2026-10")).toBe(true);
		expect(isMonth("2026-1")).toBe(false);
		expect(isMonth("2026-00")).toBe(false);
	});
});
